/**
 * POST /api/dropbox-upload
 * Chunked Dropbox upload proxy — browser sends large annotated PDFs in 4 MB slices.
 * Three operations selected by X-Upload-Op header:
 *
 *   start  : starts a Dropbox upload session → { sessionId }
 *   append : appends binary chunk (raw body)  → { ok }
 *   finish : commits session to final path    → { ok, dropboxPath }
 *
 * For append: binary body, custom headers X-Session-Id and X-Offset.
 * For finish: JSON body { sessionId, offset, dropboxPath }.
 *
 * Requires env vars:
 *   DROPBOX_REFRESH_TOKEN + DROPBOX_APP_KEY + DROPBOX_APP_SECRET  (preferred, never expires)
 *   OR DROPBOX_ACCESS_TOKEN  (fallback, short-lived, expires every 4h)
 */

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Upload-Op, X-Session-Id, X-Offset',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Auto-refreshing token cache (module-level, survives warm Lambda re-use) ──
let _dbxToken = null;
let _dbxTokenExpiry = 0;

async function getDropboxToken() {
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  if (!refreshToken) {
    // Fall back to static access token (expires every 4h)
    return process.env.DROPBOX_ACCESS_TOKEN || null;
  }
  const now = Date.now();
  if (_dbxToken && now < _dbxTokenExpiry - 300_000) return _dbxToken; // cached with 5-min buffer
  const appKey    = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;
  if (!appKey || !appSecret) throw new Error('DROPBOX_APP_KEY / DROPBOX_APP_SECRET not set');
  const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: appKey,
      client_secret: appSecret,
    }).toString(),
  });
  if (!r.ok) throw new Error(`Dropbox token refresh failed: ${r.status}`);
  const d = await r.json();
  _dbxToken       = d.access_token;
  _dbxTokenExpiry = now + d.expires_in * 1000;
  return _dbxToken;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  let token;
  try { token = await getDropboxToken(); } catch (e) {
    return { statusCode: 503, headers: corsHeaders, body: JSON.stringify({ error: e.message }) };
  }
  if (!token) {
    return { statusCode: 503, headers: corsHeaders, body: JSON.stringify({ error: 'Dropbox token not configured — set DROPBOX_REFRESH_TOKEN or DROPBOX_ACCESS_TOKEN' }) };
  }

  const op = (event.headers['x-upload-op'] || '').toLowerCase();

  // ── START ────────────────────────────────────────────────────────────────────
  if (op === 'start') {
    const r = await fetch('https://content.dropboxapi.com/2/files/upload_session/start', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({ close: false }),
        'Content-Type': 'application/octet-stream',
      },
      body: '',
    });
    const data = await r.json();
    if (!r.ok) return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: data.error_summary || 'Dropbox start failed' }) };
    return { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: data.session_id }) };
  }

  // ── APPEND ───────────────────────────────────────────────────────────────────
  if (op === 'append') {
    const sessionId = event.headers['x-session-id'];
    const offset    = parseInt(event.headers['x-offset'] || '0', 10);
    if (!sessionId) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'X-Session-Id required' }) };

    const chunk = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '', 'binary');

    const r = await fetch('https://content.dropboxapi.com/2/files/upload_session/append_v2', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({ cursor: { session_id: sessionId, offset }, close: false }),
        'Content-Type': 'application/octet-stream',
      },
      body: chunk,
    });

    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: data.error_summary || 'Append failed' }) };
    }
    return { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
  }

  // ── FINISH ───────────────────────────────────────────────────────────────────
  if (op === 'finish') {
    let body;
    try {
      body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body || '{}');
    } catch {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON body' }) };
    }

    const { sessionId, offset, dropboxPath } = body;
    if (!sessionId || !dropboxPath) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'sessionId and dropboxPath required' }) };

    const r = await fetch('https://content.dropboxapi.com/2/files/upload_session/finish', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({
          cursor: { session_id: sessionId, offset: offset || 0 },
          commit: { path: dropboxPath, mode: 'overwrite', autorename: false },
        }),
        'Content-Type': 'application/octet-stream',
      },
      body: '',
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: data.error_summary || 'Finish failed' }) };

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, dropboxPath: data.path_display }),
    };
  }

  return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: `Unknown op: ${op}. Use start, append, or finish.` }) };
};
