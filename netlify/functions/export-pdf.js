/**
 * POST /api/export-pdf
 * Generates an annotated PDF from PNG page images + vector annotation data.
 * Body: { pages: [{ pngBase64, pageWidthPt, pageHeightPt, annotations, unplaced }] }
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' }

  try {
    const bodyStr = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body || '{}'
    const { pages } = JSON.parse(bodyStr)

    if (!Array.isArray(pages) || pages.length === 0) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'pages array is required' }),
      }
    }

    const exportDoc    = await PDFDocument.create()
    const helvetica     = await exportDoc.embedFont(StandardFonts.Helvetica)
    const helveticaBold = await exportDoc.embedFont(StandardFonts.HelveticaBold)

    const FAIL_RED   = rgb(0.86, 0.15, 0.15)
    const LABEL_GRAY = rgb(0.42, 0.45, 0.50)
    const WHITE      = rgb(1, 1, 1)
    const PIN_RADIUS = 8
    const CALLOUT_W  = 120
    const CALLOUT_H  = 28

    for (const { pngBase64, pageWidthPt, pageHeightPt, annotations = [], unplaced = [] } of pages) {
      const pngBytes = Buffer.from(pngBase64, 'base64')
      const pngImage = await exportDoc.embedPng(pngBytes)
      const page     = exportDoc.addPage([pageWidthPt, pageHeightPt])

      page.drawImage(pngImage, { x: 0, y: 0, width: pageWidthPt, height: pageHeightPt })

      for (const ann of annotations) {
        const px = ann.x * pageWidthPt
        const py = (1 - ann.y) * pageHeightPt

        const calloutX = Math.max(10, px - CALLOUT_W - 12)
        const calloutY = Math.max(10, Math.min(pageHeightPt - CALLOUT_H - 10, py - CALLOUT_H / 2))

        page.drawRectangle({ x: calloutX, y: calloutY, width: CALLOUT_W, height: CALLOUT_H, color: WHITE, borderColor: FAIL_RED, borderWidth: 1 })
        page.drawText(ann.label.toUpperCase(), { x: calloutX + 5, y: calloutY + CALLOUT_H - 11, font: helvetica, size: 5, color: LABEL_GRAY })
        const expectedStr = ann.expected ? String(ann.expected).slice(0, 35) : '(none)'
        page.drawText(expectedStr, { x: calloutX + 5, y: calloutY + 5, font: helveticaBold, size: 6, color: FAIL_RED })
        page.drawLine({ start: { x: calloutX + CALLOUT_W, y: py }, end: { x: px - PIN_RADIUS, y: py }, thickness: 0.75, color: FAIL_RED, lineDashPattern: [4, 3] })
        page.drawCircle({ x: px, y: py, size: PIN_RADIUS, color: FAIL_RED })
        const nStr = String(ann.n)
        const textWidth = helveticaBold.widthOfTextAtSize(nStr, 7)
        page.drawText(nStr, { x: px - textWidth / 2, y: py - 7 * 0.35, font: helveticaBold, size: 7, color: WHITE })
      }

      if (unplaced.length > 0) {
        const LIST_W   = 130
        const LIST_H   = 28
        const LIST_GAP = 4
        const listX    = pageWidthPt - LIST_W - 10
        for (let i = 0; i < unplaced.length; i++) {
          const ann  = unplaced[i]
          const boxY = pageHeightPt - 10 - (i + 1) * (LIST_H + LIST_GAP)
          page.drawRectangle({ x: listX, y: boxY, width: LIST_W, height: LIST_H, color: WHITE, borderColor: FAIL_RED, borderWidth: 1 })
          const badgeX = listX + 10
          const badgeY = boxY + LIST_H / 2
          page.drawCircle({ x: badgeX, y: badgeY, size: 7, color: FAIL_RED })
          const nStr = String(ann.n)
          const nW   = helveticaBold.widthOfTextAtSize(nStr, 6)
          page.drawText(nStr,                   { x: badgeX - nW / 2, y: badgeY - 6 * 0.35, font: helveticaBold, size: 6, color: WHITE })
          page.drawText(ann.label.toUpperCase(), { x: listX + 22, y: boxY + LIST_H - 11, font: helvetica, size: 5, color: LABEL_GRAY })
          const expStr = ann.expected ? String(ann.expected).slice(0, 22) : '(none)'
          page.drawText(expStr, { x: listX + 22, y: boxY + 5, font: helveticaBold, size: 6, color: FAIL_RED })
        }
      }
    }

    const pdfBytes  = await exportDoc.save()
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64')

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="export.pdf"' },
      body: pdfBase64,
      isBase64Encoded: true,
    }
  } catch (err) {
    console.error('export-pdf error:', err)
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'PDF generation failed', message: err.message }),
    }
  }
}
