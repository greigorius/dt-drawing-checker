/**
 * GET /api/proxy-pdf?url=<encodedShareLink>
 * Proxies a Dropbox share link server-side to avoid browser CORS restrictions.
 */
export const handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' }

  const url = event.queryStringParameters?.url
  if (!url) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'url required' }) }

  const dlUrl = url.includes('dl=0') ? url.replace('dl=0', 'dl=1')
              : url.includes('?')     ? url + '&dl=1'
              :                         url + '?dl=1'
  try {
    const r = await fetch(dlUrl, { redirect: 'follow' })
    if (!r.ok) return { statusCode: r.status, headers: corsHeaders, body: JSON.stringify({ error: `Dropbox fetch failed: ${r.status}` }) }
    const buffer  = await r.arrayBuffer()
    const base64  = Buffer.from(buffer).toString('base64')
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/pdf' },
      body: base64,
      isBase64Encoded: true,
    }
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) }
  }
}
