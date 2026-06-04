/**
 * GET /api/scan-pending
 * Netlify fallback: queries ADF Submitted submissions and maps them to the
 * same { files: [...] } shape the local filesystem scan returns.
 * On local dev this endpoint is handled by the Express server instead.
 */
import { corsHeaders } from './_helpers.js'

const ADF_BASE_URL = 'https://axiom-drawing-flow.netlify.app'

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' }

  try {
    const r = await fetch(`${ADF_BASE_URL}/api/df/submissions?status=Submitted`)
    if (!r.ok) throw new Error(`ADF returned ${r.status}`)
    const { submissions = [] } = await r.json()

    const files = submissions
      .filter(s => s.dropboxPath)
      .map(s => ({
        filename:     s.dropboxPath.split('/').pop(),
        dropboxPath:  s.dropboxPath,
        taskCode:     s.taskCode  || '',
        drawingNo:    s.drawingNo || '',
        stage:        s.stage     || '',
        submissionId: s.id,
      }))

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ files }) }
  } catch (err) {
    console.error('[scan-pending]', err.message)
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ files: [], error: err.message }) }
  }
}
