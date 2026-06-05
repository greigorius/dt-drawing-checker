/**
 * POST /api/notion-drawing-by-number
 * Fetches a single drawing row from the Drawing Schedule by drawing number.
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
    assignedTo:             null, // resolved below from Person relation
    s4Status:               getNotionValue(p['S4 Status']),
    s4StatusDate:           getNotionValue(p['S4 Status Date']),
    s4DtDeliveryDateActual: getNotionValue(p['S4 DT Delivery Date (Actual)']),
    s5Status:               getNotionValue(p['S5 Status']),
    s5StatusDate:           getNotionValue(p['S5 Status Date']),
    s5DtDeliveryDateActual: getNotionValue(p['S5 DT Delivery Date (Actual)']),
    designStage:            getNotionValue(p['Design Stage']),
  }
}

async function resolvePersonName(personRelation) {
  const id = personRelation?.[0]?.id
  if (!id) return null
  try {
    const r = await fetch(`https://api.notion.com/v1/pages/${id}`, { headers: notionHeaders() })
    if (!r.ok) return null
    const page = await r.json()
    const titleProp = Object.values(page.properties || {}).find(p => p.type === 'title')
    return titleProp?.title?.map(t => t.plain_text).join('') || null
  } catch { return null }
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
    : { property: 'Drawing Number', title: { equals: drawingNo } }

  try {
    const r = await fetch(`https://api.notion.com/v1/databases/${DB}/query`, {
      method: 'POST', headers: notionHeaders(),
      body: JSON.stringify({ filter, page_size: 1 }),
    })