/**
 * GET /api/notion-all-projects
 * Returns all projects from Notion.
 * Env: NOTION_API_KEY, NOTION_PROJECTS_DB_ID
 */
import { corsHeaders, notionHeaders, errResponse, getNotionValue } from './_helpers.js'

const DB = process.env.NOTION_PROJECTS_DB_ID

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' }

  if (!process.env.NOTION_API_KEY || !DB) {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ projects: [], error: 'Projects database not configured' }) }
  }

  try {
    let allResults = []
    let cursor
    do {
      const body = { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }
      const r = await fetch(`https://api.notion.com/v1/databases/${DB}/query`, {
        method: 'POST', headers: notionHeaders(), body: JSON.stringify(body),
      })
      if (!r.ok) {
        const txt = await r.text().catch(() => '')
        throw Object.assign(new Error(`Notion query failed: ${r.status} ${txt.slice(0, 200)}`), { status: r.status })
      }
      const data = await r.json()
      allResults = allResults.concat(data.results || [])
      cursor = data.has_more ? data.next_cursor : undefined
    } while (cursor)

    const projects = allResults.map(row => ({
      pageId:         row.id,
      projectName:    getNotionValue(row.properties['Project Name']),
      projectNumber:  getNotionValue(row.properties['Project #']),
      projectAddress: getNotionValue(row.properties['Project Address']),
      mainContractor: getNotionValue(row.properties['Main Contractor']),
      architect:      getNotionValue(row.properties['Architect']),
    })).filter(p => p.projectName)

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ projects, error: null }) }
  } catch (err) {
    return errResponse('notion-all-projects', err)
  }
}
