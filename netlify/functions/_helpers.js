/**
 * _helpers.js — Shared utilities for dt-drawing-checker Netlify functions.
 */

export const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type':                 'application/json',
}

export function notionHeaders() {
  return {
    Authorization:    `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': '2022-06-28',
    'Content-Type':   'application/json',
  }
}

export function errResponse(tag, err) {
  console.error(`[${tag}]`, err.message)
  return {
    statusCode: err.status ?? 500,
    headers:    corsHeaders,
    body:       JSON.stringify({ error: err.message }),
  }
}

export function getNotionValue(prop) {
  if (!prop) return null
  switch (prop.type) {
    case 'title':       return prop.title?.map(t => t.plain_text).join('') || null
    case 'rich_text':   return prop.rich_text?.map(t => t.plain_text).join('') || null
    case 'select':      return prop.select?.name || null
    case 'multi_select':return prop.multi_select?.map(s => s.name).join(', ') || null
    case 'date':        return prop.date?.start || null
    case 'number':      return prop.number != null ? String(prop.number) : null
    case 'formula':
      if (prop.formula?.type === 'string')  return prop.formula.string || null
      if (prop.formula?.type === 'number')  return prop.formula.number != null ? String(prop.formula.number) : null
      if (prop.formula?.type === 'boolean') return String(prop.formula.boolean)
      if (prop.formula?.type === 'date')    return prop.formula.date?.start || null
      return null
    case 'rollup':
      if (prop.rollup?.type === 'array')
        return prop.rollup.array?.map(i => getNotionValue(i)).filter(Boolean).join(', ') || null
      if (prop.rollup?.type === 'number') return prop.rollup.number != null ? String(prop.rollup.number) : null
      if (prop.rollup?.type === 'date')   return prop.rollup.date?.start || null
      return null
    case 'relation': return (prop.relation || []).map(r => r.id).join(', ') || null
    case 'people':   return prop.people?.map(p => p.name).filter(Boolean).join(', ') || null
    case 'checkbox': return String(prop.checkbox)
    default:         return null
  }
}
