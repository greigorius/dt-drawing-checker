/**
 * GET /api/proxy-pdf?url=<encodedShareLink>
 * Proxies a Dropbox share link server-side to avoid browser CORS restrictions.
 * Note: Netlify free tier has a ~6MB response payload limit.
 * Files > ~4.5 MB will fail — use local dev for large drawings.
 */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' }

  const url = event.queryStringParameters?.url
  if (!url) return { statusCode: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'url required' }) }

  const dlUrl = url.includes('dl=0') ? url.replace('dl=0', 'dl=1')
              : url.includes('?')     ? url + '&dl=1'
              :                         url + '?dl=1'
  try {
    const r = await fetch(dlUrl, { redirect: 'follow' })
    if (!r.ok) return {
      statusCode: r.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Dropbox returned ${r.status}` })
    }

    const buffer = await r.arrayBuffer()
    const bytes  = buffer.byteLength

    // Netlify free tier: ~6MB encoded limit. Warn on oversized files.
    if (bytes > 4_500_000) {
      return {
        statusCode: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `File too large for web proxy (${(bytes/1e6).toFixed(1)} MB). Open locally.` })
      }
    }

    const base64 = Buffer.from(buffer).toString('base64')
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/pdf' },
      body: base64,
      isBase64Encoded: true,
    }
  } catch (err) {
    return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) }
  }
}
