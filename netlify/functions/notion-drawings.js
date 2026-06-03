/**
 * POST /api/notion-drawings-for-project
 * Returns drawing rows for a selected item from the Drawing Schedule DB.
 * Body: { itemPageId: string }
 * Env: NOTION_API_KEY, NOTION_DRAWING_SCHEDULE_DB_ID
 */
import { corsHeaders, notionHeaders, errResponse, getNotionValue } from './_helpers.js'

const DB = process.env.NOTION_DRAWING_SCHEDULE_DB_ID

function mapRow(row) {
  const p = row.properties
  return {
    id:                     row.id,
    project:                getNotionValue(p['Project']),
    item:                   getNotionValue(p['Item']),
    assignedTo:             getNotionValue(p['Person']),
    suffixNumber:           getNotionValue(p['Suffix #']),
    drawingNumber:          getNotionValue(p['Drawing Number']),
    pageDescription:        getNotionValue(p['Page Description']),
    drawingTitle1:          getNotionValue(p['Drawing Title 1']),
    drawingTitle2:          getNotionValue(p['Drawing Title 2']),
    drawingTitle3:          getNotionValue(p['Drawing Title 3']),
    revision:               getNotionValue(p['Rev']),
    s4Status:               getNotionValue(p['S4 Status (LOR)']),
    s4StatusDate:           getNotionValue(p['S4 Status Date (LOR)']),
    s4DtDeliveryDateActual: getNotionValue(p['S4 DT Delivery Date (Actual)']),
    s5Status:               getNotionValue(p['S5 Status (F&P)']),
    s5StatusDate:           getNotionValue(p['S5 Status Date (F&P)']),
    s5DtDeliveryDateActual: getNotionValue(p['S5 DT Delivery Date (Actual)']),
    designStage:            getNotionValue(p['Design Stage']),
  }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' }

  let body
  try { body = JSON.parse(event.body || '{}') } catch { body = {} }

  const { itemPageId } = body
  if (!itemPageId) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ rows: [], error: 'itemPageId is required' }) }
  }

  try {
    let allRows = []
    let cursor
    do {
      const reqBody = {
        page_size: 100,
        filter: { property: 'Item', relation: { contains: itemPageId } },
        sorts:  [{ property: 'Drawing Number', direction: 'ascending' }],
        ...(cursor ? { start_cursor: cursor } : {}),
      }
      const r = await fetch(`https://api.notion.com/v1/databases/${DB}/query`, {
        method: 'POST', headers: notionHeaders(), body: JSON.stringify(reqBody),
      })
      if (!r.ok) {
        const txt = await r.text().catch(() => '')
        throw Object.assign(new Error(`Notion query failed: ${r.status} ${txt.slice(0, 200)}`), { status: r.status })
      }
      const data = await r.json()
      allRows = allRows.concat((data.results || []).map(mapRow))
      cursor = data.has_more ? data.next_cursor : undefined
    } while (cursor)

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ rows: allRows, error: null }) }
  } catch (err) {
    return errResponse('notion-drawings', err)
  }
}
