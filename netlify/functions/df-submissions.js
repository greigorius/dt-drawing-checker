/**
 * GET /api/df-submissions
 * Proxies ADF's Submitted submissions list to the DT Checker client.
 */
import { corsHeaders } from './_helpers.js'

const ADF_BASE_URL = 'https://axiom-drawing-flow.netlify.app'

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' }

  try {
    const r = await fetch(`${ADF_BASE_URL}/api/df/submissions?status=Submitted`)
    if (!r.ok) throw new Error(`ADF returned ${r.status}`)
    const data = await r.json()
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(data) }
  } catch (err) {
    console.error('[df-submissions]', err.message)
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ submissions: [], error: err.message }) }
  }
}
