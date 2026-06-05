/**
 * GET /api/notion-drawing-by-id?id=<notionPageId>
 * Fetches a Drawing Schedule page directly by ID — no filter needed, guaranteed match.
 * Uses the drawingIds from ADF submissions response.
 */
import { corsHeaders, notionHeaders, getNotionValue } from './_helpers.js'

function mapRow(row) {
  const p = row.properties
  return {
    suffixNumber:           getNotionValue(p['Suffix #']),
    drawingNumber:          getNotionValue(p['Drawing Number']),
    drawingTitle1:          getNotionValue(p['Drawing Title 1']),
    drawingTitle2:          getNotionValue(p['Drawing Title 2']),
    drawingTitle3:          getNotionValue(p['Drawing Title 3']),
    revision:               getNotionValue(p['Rev']),
    assignedTo:             null, // resolved below
    s4Status:               getNotionValue(p['S4 Status']),
    s4StatusDate:           getNotionValue(p['S4 Status Date']),
    s4DtDeliveryDateActual: getNotionValue(p['S4 DT Delivery Date (Actual)']),
    s5Status:               getNotionValue(p['S5 Status']),
    s5StatusDate:           getNotionValue(p['S5 Status Date']),
    s5DtDeliveryDateActual: getNotionValue(p['S5 DT Delivery Date (Actual)']),
    designStage:            getNotionValue(p['Design Stage']),
  }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' }

  const id = event.queryStringParameters?.id
  if (!id) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ row: null, error: 'id required' }) }

  try {
    const r = await fetch(`https://api.notion.com/v1/pages/${id}`, { headers: notionHeaders() })
    if (!r.ok) return { statusCode: r.status, headers: corsHeaders, body: JSON.stringify({ row: null, error: `Notion returned ${r.status}` }) }

    const page = await r.json()
    const row  = mapRow(page)

    // Resolve Person relation to a display name
    const personIds = page.properties['Person']?.relation || []
    if (personIds.length) {
      try {
        const pr = await fetch(`https://api.notion.com/v1/pages/${personIds[0].id}`, { headers: notionHeaders() })
        if (pr.ok) {
          const personPage = await pr.json()
          const titleProp  = Object.values(personPage.properties || {}).find(p => p.type === 'title')
          row.assignedTo   = titleProp?.title?.map(t => t.plain_text).join('') || null
        }
      } catch { /* non-fatal */ }
    }

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ row }) }
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ row: null, error: err.message }) }
  }
}
