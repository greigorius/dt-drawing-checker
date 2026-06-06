/**
 * Browser-side PDF annotation using pdf-lib.
 * Mirrors the server-side netlify/functions/annotate-pdf.js logic.
 * Works on a SINGLE page extracted from the original PDF.
 *
 * @param {string} pdfBase64          - Full original PDF as base64
 * @param {number} pageIndex          - 0-based index of the page to extract & annotate
 * @param {Array}  annotations        - [{ n, x?, y?, label, expected }]  x/y are fractions
 * @param {Array}  sketchObjects      - sketch objects for this page
 * @returns {Promise<string>}         - annotated single-page PDF as base64
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

function hexToRgb(hex) {
  const h = (hex || '#000000').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

export async function annotateSinglePage({ pdfBase64, pageIndex, annotations = [], sketchObjects = [] }) {
  // Decode original PDF
  const originalBytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));
  const originalDoc   = await PDFDocument.load(originalBytes, { ignoreEncryption: true });

  // Extract just the one page into a new document
  const singleDoc = await PDFDocument.create();
  const [copiedPage] = await singleDoc.copyPages(originalDoc, [pageIndex]);
  singleDoc.addPage(copiedPage);

  const helvetica     = await singleDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await singleDoc.embedFont(StandardFonts.HelveticaBold);

  const FAIL_RED   = rgb(0.86, 0.15, 0.15);
  const LABEL_GRAY = rgb(0.42, 0.45, 0.50);
  const WHITE      = rgb(1, 1, 1);

  const page = singleDoc.getPages()[0];
  const { width: pw, height: ph } = page.getSize();
  const fx = (fX) => fX * pw;
  const fy = (fY) => ph - fY * ph;  // PDF y-axis is bottom-up

  // ── Sketch objects ──
  for (const obj of sketchObjects) {
    try {
      switch (obj.type) {
        case 'rect': {
          const [r, g, b] = hexToRgb(obj.color);
          page.drawRectangle({
            x: Math.min(fx(obj.x1), fx(obj.x2)),
            y: Math.min(fy(obj.y1), fy(obj.y2)),
            width:  Math.abs(fx(obj.x2) - fx(obj.x1)),
            height: Math.abs(fy(obj.y2) - fy(obj.y1)),
            borderColor: rgb(r, g, b), borderWidth: obj.width || 1, color: undefined,
          });
          break;
        }
        case 'highlight':
          page.drawRectangle({
            x: Math.min(fx(obj.x1), fx(obj.x2)),
            y: Math.min(fy(obj.y1), fy(obj.y2)),
            width:  Math.abs(fx(obj.x2) - fx(obj.x1)),
            height: Math.abs(fy(obj.y2) - fy(obj.y1)),
            color: rgb(1, 0.90, 0), opacity: 0.35,
          });
          break;
        case 'line':
        case 'arrow': {
          const [r, g, b] = hexToRgb(obj.color);
          page.drawLine({
            start: { x: fx(obj.x1), y: fy(obj.y1) },
            end:   { x: fx(obj.x2), y: fy(obj.y2) },
            thickness: obj.width || 1, color: rgb(r, g, b),
          });
          break;
        }
        case 'ellipse': {
          const [r, g, b] = hexToRgb(obj.color);
          page.drawEllipse({
            x: fx(obj.cx), y: fy(obj.cy),
            xScale: obj.rx * pw, yScale: obj.ry * ph,
            borderColor: rgb(r, g, b), borderWidth: obj.width || 1, color: undefined,
          });
          break;
        }
        case 'text': {
          const [r, g, b] = hexToRgb(obj.color);
          const fs = Math.max(6, (obj.fontSizeFrac || 0.025) * ph);
          page.drawText(obj.content || '', {
            x: fx(obj.x), y: fy(obj.y) - fs,
            font: helvetica, size: fs, color: rgb(r, g, b),
          });
          break;
        }
        case 'stroke': {
          if (!obj.points?.length || obj.points.length < 2) break;
          const [r, g, b] = hexToRgb(obj.color);
          for (let i = 0; i < obj.points.length - 1; i++) {
            page.drawLine({
              start: { x: fx(obj.points[i].x),     y: fy(obj.points[i].y) },
              end:   { x: fx(obj.points[i + 1].x), y: fy(obj.points[i + 1].y) },
              thickness: obj.width || 1,
              color: rgb(r, g, b),
            });
          }
          break;
        }
        default: break;
      }
    } catch { /* skip malformed objects */ }
  }

  // ── Pin annotations ──
  const PIN_R = 8, CW = 120, CH = 24;
  const placed   = annotations.filter(a => a.x != null);
  const unplaced = annotations.filter(a => a.x == null);

  for (const ann of placed) {
    const px2 = fx(ann.x), py2 = fy(ann.y);
    const cxL = Math.max(10, px2 - CW - 10);
    const cyB = Math.max(10, py2 - CH / 2);

    page.drawRectangle({ x: cxL, y: cyB, width: CW, height: CH, color: WHITE, borderColor: FAIL_RED, borderWidth: 1 });
    page.drawText((ann.label || '').toUpperCase(), { x: cxL + 4, y: cyB + CH - 9, font: helvetica,     size: 5, color: LABEL_GRAY });
    page.drawText(String(ann.expected || '(none)').slice(0, 30), { x: cxL + 4, y: cyB + 4, font: helveticaBold, size: 6, color: FAIL_RED });
    page.drawLine({ start: { x: cxL + CW, y: py2 }, end: { x: px2 - PIN_R, y: py2 }, thickness: 0.75, color: FAIL_RED });
    page.drawCircle({ x: px2, y: py2, size: PIN_R, color: FAIL_RED });
    const nStr = String(ann.n || '');
    const nW   = helveticaBold.widthOfTextAtSize(nStr, 7);
    page.drawText(nStr, { x: px2 - nW / 2, y: py2 - 2.5, font: helveticaBold, size: 7, color: WHITE });
  }

  const LW = 130, LH = 24, LG = 4, listX = pw - LW - 10;
  unplaced.forEach((ann, i) => {
    const boxY = ph - 10 - (i + 1) * (LH + LG);
    page.drawRectangle({ x: listX, y: boxY, width: LW, height: LH, color: WHITE, borderColor: FAIL_RED, borderWidth: 1 });
    page.drawCircle({ x: listX + 9, y: boxY + LH / 2, size: 7, color: FAIL_RED });
    const nW = helveticaBold.widthOfTextAtSize(String(ann.n || ''), 6);
    page.drawText(String(ann.n || ''), { x: listX + 9 - nW / 2, y: boxY + LH / 2 - 2, font: helveticaBold, size: 6, color: WHITE });
    page.drawText((ann.label || '').toUpperCase(), { x: listX + 20, y: boxY + LH - 9, font: helvetica, size: 5, color: LABEL_GRAY });
    page.drawText(String(ann.expected || '(none)').slice(0, 20), { x: listX + 20, y: boxY + 4, font: helveticaBold, size: 6, color: FAIL_RED });
  });

  // Save and return as base64
  const outBytes = await singleDoc.save();
  const bytes    = new Uint8Array(outBytes);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
