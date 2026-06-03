/**
 * POST /api/notion-suffixes-for-project
 * Returns unique {suffixNumber, itemPageId} pairs for a project.
 * Filters Drawing Schedule by the Project formula string.
 * Body: { projectName: string }
 * Env: NOTION_API_KEY, NOTION_DRAWING_SCHEDULE_DB_ID
 */
import { corsHeaders, notionHeaders, errResponse, getNotionValue } from './_helpers.js'

const DB = process.env.NOTION_DRAWING_SCHEDULE_DB_ID

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' }

  let body
  try { body = JSON.parse(event.body || '{}') } catch { body = {} }

  const { projectName } = body
  if (!projectName) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ suffixes: [], error: 'projectName is required' }) }
  }
  if (!process.env.NOTION_API_KEY || !DB) {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ suffixes: [], error: 'Drawing Schedule database not configured' }) }
  }

  // Use the first token of the project name (e.g. "24-367") as a reliable filter
  const projectIdentifier = projectName.split(' ')[0]

  try {
    let allRows = []
    let cursor
    do {
      const reqBody = {
        page_size: 100,
        filter: { property: 'Project', formula: { string: { contains: projectIdentifier } } },
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
      allRows = allRows.concat(data.results || [])
      cursor = data.has_more ? data.next_cursor : undefined
    } while (cursor)

    // Deduplicate by itemPageId (or suffixNumber as fallback)
    const seen = new Set()
    const suffixes = []
    for (const row of allRows) {
      const p = row.properties
      const suffixNumber = getNotionValue(p['Suffix #'])
      const itemPageId   = p['Item']?.relation?.[0]?.id || null
      const key = itemPageId || suffixNumber
      if (key && !seen.has(key)) {
        seen.add(key)
        suffixes.push({ suffixNumber, itemPageId })
      }
    }
    suffixes.sort((a, b) => (a.suffixNumber || '').localeCompare(b.suffixNumber || ''))

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ suffixes, error: null }) }
  } catch (err) {
    return errResponse('notion-suffixes', err)
  }
}
