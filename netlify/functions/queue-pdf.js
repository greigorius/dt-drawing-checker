/**
 * POST /api/queue-pdf
 * Called by Make Scenario 1 after ingest — queues a PDF for the DT Checker client to pick up.
 * Body: { downloadUrl, filename, filePath, submissionId }
 * Uses Netlify Blobs for persistence across serverless invocations.
 */
import { getStore } from '@netlify/blobs'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' }

  let body
  try { body = JSON.parse(event.body || '{}') } catch { body = {} }

  const { downloadUrl, filename, filePath, submissionId } = body
  if (!downloadUrl || !filename) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ ok: false, error: 'downloadUrl and filename are required' }) }
  }

  try {
    const store    = getStore('pdf-queue')
    const existing = JSON.parse(await store.get('queue') || '[]')
    existing.push({ downloadUrl, filename, filePath: filePath || null, submissionId: submissionId || null, queuedAt: new Date().toISOString() })
    await store.set('queue', JSON.stringify(existing))
    console.log(`[queue-pdf] queued: ${filename}`)
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, queued: existing.length }) }
  } catch (err) {
    console.error('[queue-pdf]', err.message)
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ ok: false, error: err.message }) }
  }
}
