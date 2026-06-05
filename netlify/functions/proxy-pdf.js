/**
 * GET /api/proxy-pdf?url=<encodedShareLink>
 * Resolves the Dropbox share link to a final CDN URL (dl.dropboxusercontent.com)
 * which has CORS headers — the browser then fetches the PDF directly.
 * This avoids proxying large binary files through the Netlify function payload limit.
 */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' }

  const url = event.queryStringParameters?.url
  if (!url) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'url required' }) }

  const dlUrl = url.includes('dl=0') ? url.replace('dl=0', 'dl=1')
              : url.includes('?')     ? url + '&dl=1'
              :                         url + '?dl=1'

  try {
    // Follow redirects to get the final dl.dropboxusercontent.com CDN URL
    // The CDN URL has proper CORS headers so the browser can fetch directly
    const r = await fetch(dlUrl, { redirect: 'follow' })
    const cdnUrl = r.url  // final URL after all redirects

    // Verify it looks like a Dropbox CDN URL
    if (!cdnUrl || (!cdnUrl.includes('dropboxusercontent') && !cdnUrl.includes('dropbox'))) {
      return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'Could not resolve CDN URL' }) }
    }

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ cdnUrl }) }
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) }
  }
}
