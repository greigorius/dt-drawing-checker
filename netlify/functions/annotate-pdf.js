/**
 * POST /api/annotate-pdf
 * Loads the original PDF bytes and adds vector annotations (pins + sketches).
 * No rasterization — fully resolution-independent, small file size.
 * Body: { pdfBase64, annotations: [{pageIndex,n,x?,y?,label,expected}], sketchesByPage: {[pi]: obj[]} }
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

function hexToRgb(hex) {
  const h = (hex || '#000000').replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c+c).join('') : h, 16)
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]
}

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' }

  let body
  try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body,'base64').toString() : event.body || '{}') }
  catch { return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON' }) } }

  const { pdfBase64, annotations = [], sketchesByPage = {} } = body
  if (!pdfBase64) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'pdfBase64 required' }) }

  try {
    const pdfBytes      = Buffer.from(pdfBase64, 'base64')
    const pdfDoc        = await PDFDocument.load(pdfBytes)
    const helvetica     = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
    const pages = pdfDoc.getPages()

    const FAIL_RED   = rgb(0.86, 0.15, 0.15)
    const LABEL_GRAY = rgb(0.42, 0.45, 0.50)
    const WHITE      = rgb(1, 1, 1)

    for (let pi = 0; pi < pages.length; pi++) {
      const page = pages[pi]
      const { width: pw, height: ph } = page.getSize()
      const fy = (fY) => ph - fY * ph
      const fx = (fX) => fX * pw

      // Sketch objects
      for (const obj of (sketchesByPage[pi] || [])) {
        try {
          switch (obj.type) {
            case 'rect': {
              const [r,g,b] = hexToRgb(obj.color)
              page.drawRectangle({ x: Math.min(fx(obj.x1),fx(obj.x2)), y: Math.min(fy(obj.y1),fy(obj.y2)), width: Math.abs(fx(obj.x2)-fx(obj.x1)), height: Math.abs(fy(obj.y2)-fy(obj.y1)), borderColor: rgb(r,g,b), borderWidth: obj.width||1, color: undefined })
              break
            }
            case 'highlight':
              page.drawRectangle({ x: Math.min(fx(obj.x1),fx(obj.x2)), y: Math.min(fy(obj.y1),fy(obj.y2)), width: Math.abs(fx(obj.x2)-fx(obj.x1)), height: Math.abs(fy(obj.y2)-fy(obj.y1)), color: rgb(1,0.90,0), opacity: 0.35 })
              break
            case 'line':
            case 'arrow': {
              const [r,g,b] = hexToRgb(obj.color)
              page.drawLine({ start: { x: fx(obj.x1), y: fy(obj.y1) }, end: { x: fx(obj.x2), y: fy(obj.y2) }, thickness: obj.width||1, color: rgb(r,g,b) })
              break
            }
            case 'ellipse': {
              const [r,g,b] = hexToRgb(obj.color)
              page.drawEllipse({ x: fx(obj.cx), y: fy(obj.cy), xScale: obj.rx*pw, yScale: obj.ry*ph, borderColor: rgb(r,g,b), borderWidth: obj.width||1, color: undefined })
              break
            }
            case 'text': {
              const [r,g,b] = hexToRgb(obj.color)
              const fs = Math.max(6, (obj.fontSizeFrac||0.025)*ph)
              page.drawText(obj.content||'', { x: fx(obj.x), y: fy(obj.y)-fs, font: helvetica, size: fs, color: rgb(r,g,b) })
              break
            }
          }
        } catch { /* skip broken object */ }
      }

      // Pin annotations
      const PIN_R = 8, CW = 120, CH = 24
      const pageAnns  = annotations.filter(a => a.pageIndex === pi && a.x != null)
      const unplaced  = annotations.filter(a => a.pageIndex === pi && a.x == null)

      for (const ann of pageAnns) {
        const px2 = fx(ann.x), py2 = fy(ann.y)
        const cxL = Math.max(10, px2 - CW - 10), cyB = Math.max(10, py2 - CH/2)
        page.drawRectangle({ x: cxL, y: cyB, width: CW, height: CH, color: WHITE, borderColor: FAIL_RED, borderWidth: 1 })
        page.drawText((ann.label||'').toUpperCase(), { x: cxL+4, y: cyB+CH-9, font: helvetica, size: 5, color: LABEL_GRAY })
        page.drawText(String(ann.expected||'(none)').slice(0,30), { x: cxL+4, y: cyB+4, font: helveticaBold, size: 6, color: FAIL_RED })
        page.drawLine({ start: { x: cxL+CW, y: py2 }, end: { x: px2-PIN_R, y: py2 }, thickness: 0.75, color: FAIL_RED })
        page.drawCircle({ x: px2, y: py2, size: PIN_R, color: FAIL_RED })
        const nStr = String(ann.n||'')
        const nW = helveticaBold.widthOfTextAtSize(nStr, 7)
        page.drawText(nStr, { x: px2-nW/2, y: py2-2.5, font: helveticaBold, size: 7, color: WHITE })
      }

      const LW = 130, LH = 24, LG = 4, listX = pw - LW - 10
      unplaced.forEach((ann, i) => {
        const boxY = ph - 10 - (i+1)*(LH+LG)
        page.drawRectangle({ x: listX, y: boxY, width: LW, height: LH, color: WHITE, borderColor: FAIL_RED, borderWidth: 1 })
        page.drawCircle({ x: listX+9, y: boxY+LH/2, size: 7, color: FAIL_RED })
        const nW = helveticaBold.widthOfTextAtSize(String(ann.n||''), 6)
        page.drawText(String(ann.n||''), { x: listX+9-nW/2, y: boxY+LH/2-2, font: helveticaBold, size: 6, color: WHITE })
        page.drawText((ann.label||'').toUpperCase(), { x: listX+20, y: boxY+LH-9, font: helvetica, size: 5, color: LABEL_GRAY })
        page.drawText(String(ann.expected||'(none)').slice(0,20), { x: listX+20, y: boxY+4, font: helveticaBold, size: 6, color: FAIL_RED })
      })
    }

    const outBytes  = await pdfDoc.save()
    const outBase64 = Buffer.from(outBytes).toString('base64')
    return { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/pdf' }, body: outBase64, isBase64Encoded: true }
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) }
  }
}
