/**
 * POST /api/finishes-lookup
 * Finishes database lookup by suffix number (and optionally project page ID).
 * Body: { suffixNumber: string, projectPageId?: string }
 * Env: NOTION_API_KEY, NOTION_FINISHES_DB_ID
 */
import { corsHeaders, notionHeaders, errResponse, getNotionValue } from './_helpers.js'

const DB = process.env.NOTION_FINISHES_DB_ID

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' }

  if (!DB) {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ rows: [], error: 'Finishes database not configured' }) }
  }

  let body
  try { body = JSON.parse(event.body || '{}') } catch { body = {} }

  const { suffixNumber, projectPageId } = body
  if (!suffixNumber) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ rows: [], error: 'suffixNumber is required' }) }
  }

  const suffixFilter = {
    property: 'Suffix',
    rollup: { any: { rich_text: { equals: suffixNumber } } },
  }
  const filter = projectPageId
    ? { and: [suffixFilter, { property: 'Project', relation: { contains: projectPageId } }] }
    : suffixFilter

  try {
    const r = await fetch(`https://api.notion.com/v1/databases/${DB}/query`, {
      method: 'POST', headers: notionHeaders(), body: JSON.stringify({ filter, page_size: 100 }),
    })
    if (!r.ok) {
      const txt = await r.text().catch(() => '')
      throw Object.assign(new Error(`Notion query failed: ${r.status} ${txt.slice(0, 200)}`), { status: r.status })
    }
    const data = await r.json()
    const rows = (data.results || []).map(page => {
      const p = page.properties
      return {
        specRef:           getNotionValue(p['Spec Ref']),
        cadRef:            getNotionValue(p['CAD Ref']),
        finishDescription: getNotionValue(p['Finish Description']),
        sampleRef:         getNotionValue(p['Sample Ref']),
        approved:          getNotionValue(p['APPROVED']),
        pageId:            page.id,
      }
    })

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ rows, error: null }) }
  } catch (err) {
    return errResponse('finishes-lookup', err)
  }
}
