/**
 * GET /api/queued-pdfs
 * Returns queued PDFs and clears the queue so each item is only loaded once.
 * Uses Netlify Blobs for persistence across serverless invocations.
 */
import { getStore } from '@netlify/blobs'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' }

  try {
    const store = getStore('pdf-queue')
    const raw   = await store.get('queue')
    const items = raw ? JSON.parse(raw) : []
    if (items.length) await store.set('queue', '[]') // clear after reading
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ items }) }
  } catch (err) {
    console.error('[queued-pdfs]', err.message)
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ items: [], error: err.message }) }
  }
}
