/**
 * POST /api/notion-drawing-by-number
 * Fetches a single drawing row from the Drawing Schedule by drawing number.
 * Bypasses the suffix chain — drawing number is known directly from filename.
 * Body: { drawingNo, projectNo }
 */
import { corsHeaders, notionHeaders, errResponse, getNotionValue } from './_helpers.js'

const DB = process.env.NOTION_DRAWING_SCHEDULE_DB_ID

function mapRow(row) {
  const p = row.properties
  return {
    suffixNumber:           getNotionValue(p['Suffix #']),
    drawingNumber:          getNotionValue(p['Drawing Number']),
    drawingTitle1:          getNotionValue(p['Drawing Title 1']),
    drawingTitle2:          getNotionValue(p['Drawing Title 2']),
    drawingTitle3:          getNotionValue(p['Drawing Title 3']),
    revision:               getNotionValue(p['Rev']),
    assignedTo:             getNotionValue(p['Person']),
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
  const { drawingNo, projectNo } = body
  if (!drawingNo) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ row: null, error: 'drawingNo required' }) }

  const filter = projectNo
    ? { and: [
        { property: 'Drawing Number', title: { equals: drawingNo } },
        { property: 'Project', formula: { string: { contains: projectNo } } },
      ]}
    : { property: 'Drawing Number', rich_text: { equals: drawingNo } }

  try {
    const r = await fetch(`https://api.notion.com/v1/databases/${DB}/query`, {
      method: 'POST', headers: notionHeaders(),
      body: JSON.stringify({ filter, page_size: 1 }),
    })
    if (!r.ok) throw Object.assign(new Error(`Notion query failed: ${r.status}`), { status: r.status })
    const data = await r.json()
    const row  = data.results?.[0] ? mapRow(data.results[0]) : null
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ row }) }
  } catch (err) {
    return errResponse('notion-drawing-by-number', err)
  }
}
