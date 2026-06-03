import React, { useState, useCallback } from 'react';
import JSZip from 'jszip';

const ISSUED_FOR_OPTIONS = [
  { value: 'A4.5', label: 'A4.5 - AUTHORISED MFG. and CONST. DESIGN' },
  { value: 'APPROVAL', label: 'APPROVAL' },
  { value: 'AS BUILT', label: 'AS BUILT' },
  { value: 'CONSTRUCTION', label: 'CONSTRUCTION' },
  { value: 'INFORMATION', label: 'INFORMATION' },
  { value: 'S4', label: 'S4 - FOR REVIEW AND AUTHORISATION' },
  { value: 'S5', label: 'S5 - FOR REVIEW AND ACCEPTANCE' },
];

// Build all check rows for a single page from manual selections (mirrors App.jsx buildPageResults)
function buildPageRows(manualProject, manualSel) {
  const issuedForLabel = ISSUED_FOR_OPTIONS.find(o => o.value === manualSel?.issuedFor)?.label || null;
  const statusBy =
    manualSel?.issuedFor === 'S5' ? manualProject?.mainContractor :
    manualSel?.issuedFor === 'A4.5' ? manualProject?.architect : null;

  return [
    { field: 'projectName',   label: 'Project Name',   expected: manualProject?.projectName    || null },
    { field: 'projectNumber', label: 'Project Number', expected: manualProject?.projectNumber  || null },
    { field: 'clientName',    label: 'Client Name',    expected: manualProject?.mainContractor || null },
    { field: 'suffixNumber',  label: 'Suffix Number',  expected: manualSel?.suffixNumber                    || null },
    { field: 'drawingNumber', label: 'Drawing Number', expected: manualSel?.drawingNumber                   || null },
    { field: 'drawingTitle',  label: 'Drawing Title 1', expected: manualSel?.notionRow?.drawingTitle1       || null },
    { field: 'drawingTitle2', label: 'Drawing Title 2', expected: manualSel?.notionRow?.drawingTitle2       || null },
    { field: 'drawingTitle3', label: 'Drawing Title 3', expected: manualSel?.notionRow?.drawingTitle3       || null },
    { field: 'revision',      label: 'Revision',        expected: manualSel?.notionRow?.revision            || null },
    { field: 'issuedFor',     label: 'Issued For',      expected: issuedForLabel },
    { field: 'status',        label: 'Status',          expected: manualSel?.notionRow?.s5Status            || null },
    { field: 'statusBy',      label: 'Status By',       expected: statusBy },
    { field: 'statusDate',    label: 'Status Date',     expected: manualSel?.notionRow?.s5StatusDate        || null },
    { field: 'author',        label: 'Author',          expected: manualSel?.notionRow?.assignedTo          || null },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Canvas drawing helpers
// ─────────────────────────────────────────────────────────────────────────────

function roundedRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// Draw pin-based annotations on an export canvas.
// pinsForPage: { [field]: { x, y } }  — fractions of canvas dimensions
// failItems: [{ field, label, expected }] in numbered order
function drawPinAnnotations(ctx, pinsForPage, failItems, canvasWidth, canvasHeight) {
  const RADIUS = 12;
  const CALLOUT_W = 220;
  const CALLOUT_H = 44;

  // Draw placed pins with callout boxes
  failItems.forEach((fi, i) => {
    const pin = pinsForPage[fi.field];
    if (!pin) return;

    const n = i + 1;
    const px = pin.x * canvasWidth;
    const py = pin.y * canvasHeight;

    // Callout to the left of the pin
    const calloutX = Math.max(10, px - CALLOUT_W - 18);
    const calloutY = Math.max(10, py - CALLOUT_H / 2);

    // Callout box
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;
    ctx.beginPath();
    roundedRect(ctx, calloutX, calloutY, CALLOUT_W, CALLOUT_H, 4);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    roundedRect(ctx, calloutX, calloutY, CALLOUT_W, CALLOUT_H, 4);
    ctx.stroke();
    ctx.restore();

    // Label text
    ctx.save();
    ctx.fillStyle = '#6b7280';
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(fi.label.toUpperCase(), calloutX + 8, calloutY + 14);
    ctx.restore();

    // Expected value text
    ctx.save();
    ctx.fillStyle = '#dc2626';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'left';
    const expectedStr = fi.expected ? String(fi.expected).slice(0, 40) : '(none)';
    ctx.fillText(expectedStr, calloutX + 8, calloutY + 30);
    ctx.restore();

    // Dashed connector line
    ctx.save();
    ctx.strokeStyle = '#dc2626';
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(calloutX + CALLOUT_W, py);
    ctx.lineTo(px - RADIUS, py);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Pin circle
    ctx.save();
    ctx.fillStyle = '#dc2626';
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(px, py, RADIUS, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();

    // Pin number
    ctx.save();
    ctx.fillStyle = 'white';
    ctx.font = `bold ${RADIUS > 10 ? 10 : 9}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), px, py);
    ctx.restore();
  });

  // Unplaced fails: stack in top-right corner
  const unplaced = failItems.filter(fi => !pinsForPage[fi.field]);
  if (unplaced.length > 0) {
    const listX = canvasWidth - 230;
    unplaced.forEach((fi, i) => {
      const n = failItems.indexOf(fi) + 1;
      const y = 20 + i * 52;

      // Box
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = 'rgba(0,0,0,0.15)';
      ctx.shadowBlur = 4;
      ctx.beginPath();
      roundedRect(ctx, listX, y, 210, 44, 4);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      roundedRect(ctx, listX, y, 210, 44, 4);
      ctx.stroke();
      ctx.restore();

      // Number badge inside box
      ctx.save();
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.arc(listX + 16, y + 22, 9, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = 'white';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(n), listX + 16, y + 22);
      ctx.restore();

      // Label
      ctx.save();
      ctx.fillStyle = '#6b7280';
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(fi.label.toUpperCase(), listX + 30, y + 15);
      ctx.restore();

      // Expected
      ctx.save();
      ctx.fillStyle = '#dc2626';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'left';
      const str = fi.expected ? String(fi.expected).slice(0, 35) : '(none)';
      ctx.fillText(str, listX + 30, y + 30);
      ctx.restore();
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// File-saving helpers
// ─────────────────────────────────────────────────────────────────────────────

function canvasToBlob(canvas) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Open a native Save As dialog for a single file.
// Returns the FileSystemFileHandle, or null if FSA unavailable / user cancelled.
async function openSaveDialog(suggestedName, mimeType, extensions) {
  if (!('showSaveFilePicker' in window)) return null;
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [{ description: mimeType, accept: { [mimeType]: extensions } }],
    });
    return handle;
  } catch (e) {
    if (e.name === 'AbortError') return 'cancelled';
    return null; // FSA failed — caller will fall back to download
  }
}

async function writeToHandle(handle, blob) {
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// ExportSection — inline collapsible panel section (no modal overlay)
// ─────────────────────────────────────────────────────────────────────────────

const SECTION_KEY = 'export-markups';

export default function ExportSection({
  pdfs,
  filterByOptions,
  getOverride,
  collapsed,
  toggleCollapse,
  pins = {},
  finishesOverrides = {},
}) {
  const isCollapsed = collapsed[SECTION_KEY];

  const checkedDone = pdfs.filter(p => p.checked && p.pdfDoc);
  const totalPages = checkedDone.reduce((s, p) => s + p.totalPages, 0);

  const [exportPdf, setExportPdf] = useState(true);
  const [exportPng, setExportPng] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState(null);

  const canExport = (exportPdf || exportPng) && checkedDone.length > 0;

  const handleExport = useCallback(async () => {
    if (!canExport) return;

    // ── Compute date-based filenames ──
    // Zip: YYMMDD_DM_Checks.zip
    // PDF inside zip: YYMMDD_DM_Checks_<drawingNum with last digit → X>.pdf
    const now = new Date();
    const yy = String(now.getFullYear()).slice(2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const datePrefix = `${yy}${mm}${dd}`;
    const zipBasename = `${datePrefix}_DM_Checks`;

    const firstDrawingNum = checkedDone[0]?.manualSelections?.[0]?.drawingNumber || '';
    const drawingNumX = firstDrawingNum ? `${firstDrawingNum.slice(0, -1)}X` : '';
    const pdfBasename = drawingNumX ? `${zipBasename}_${drawingNumX}` : zipBasename;

    // ── Determine output format & open native Save dialog IMMEDIATELY ──
    let outputType; // 'pdf' | 'png' | 'zip'
    if (exportPdf && !exportPng) {
      outputType = 'pdf';
    } else if (!exportPdf && exportPng && totalPages === 1) {
      outputType = 'png';
    } else {
      outputType = 'zip';
    }

    const suggestedName =
      outputType === 'pdf' ? `${pdfBasename}.pdf`
      : outputType === 'png' ? `${firstDrawingNum || zipBasename}.png`
      : `${zipBasename}.zip`;

    const mimeTypes = {
      pdf: ['application/pdf', ['.pdf']],
      png: ['image/png', ['.png']],
      zip: ['application/zip', ['.zip']],
    };
    const [mime, exts] = mimeTypes[outputType];

    const fileHandle = await openSaveDialog(suggestedName, mime, exts);
    if (fileHandle === 'cancelled') return;

    // ── Now render & process ──
    setExporting(true);
    setResult(null);

    // 150 DPI — higher resolution for both PNG quality and PDF backing image
    const EXPORT_SCALE = 150 / 72;

    try {
      const pdfPageData = [];
      const pngBlobs = [];
      const pngNames = [];
      let pageNum = 0;

      for (const pdf of checkedDone) {
        for (let pi = 0; pi < pdf.totalPages; pi++) {
          pageNum++;

          setProgress(`Rendering page ${pageNum} of ${totalPages}\u2026`);

          // ── Compute fail items for this page from manual overrides ──
          const manualSel = pdf.manualSelections?.[pi] || {};
          const manualProject = pdf.manualProject || null;
          const standardRows = filterByOptions(buildPageRows(manualProject, manualSel));
          const customRows = (pdf.customFields?.[pi] || []).map(cf => ({
            field: cf.id,
            label: cf.section || cf.label || 'Custom',
            expected: cf.expected || null,
          }));

          const failItems = [...standardRows, ...customRows]
            .filter(r => getOverride?.(pdf.id, pi, r.field) === 'fail')
            .map(r => ({ field: r.field, label: r.label, expected: r.expected || '' }));

          // Add finishes fails (page 0 pins shown on all pages)
          if (pi === 0) {
            (pdf.finishesRows || []).forEach((row, i) => {
              if (finishesOverrides[`${pdf.id}-${i}`] === 'fail') {
                failItems.push({
                  field: `finishes-row-${i}`,
                  label: `Finishes: ${row.cadRef || row.specRef || `Row ${i + 1}`}`,
                  expected: row.finishDescription || '',
                });
              }
            });
          }

          // ── Render page to canvas (clean — no annotations yet) ──
          const pdfPage = await pdf.pdfDoc.getPage(pi + 1);
          const vp1 = pdfPage.getViewport({ scale: 1 });
          const viewport = pdfPage.getViewport({ scale: EXPORT_SCALE });

          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const ctx = canvas.getContext('2d');

          await pdfPage.render({ canvasContext: ctx, viewport }).promise;

          // ── PDF: capture clean backing image + build vector annotation data ──
          if (exportPdf) {
            const pinsForThisPage = pins[pdf.id]?.[pi] || {};
            const annotations = [];
            const unplaced = [];
            failItems.forEach((fi, i) => {
              const pin = pinsForThisPage[fi.field];
              if (pin) {
                annotations.push({ n: i + 1, x: pin.x, y: pin.y, label: fi.label, expected: fi.expected });
              } else {
                unplaced.push({ n: i + 1, label: fi.label, expected: fi.expected });
              }
            });
            pdfPageData.push({
              pngBase64: canvas.toDataURL('image/png').split(',')[1],
              pageWidthPt: vp1.width,
              pageHeightPt: vp1.height,
              annotations,
              unplaced,
            });
          }

          // ── PNG: draw raster annotations then capture ──
          if (exportPng) {
            if (failItems.length > 0) {
              const pinsForThisPage = pins[pdf.id]?.[pi] || {};
              drawPinAnnotations(ctx, pinsForThisPage, failItems, canvas.width, canvas.height);
            }
            const blob = await canvasToBlob(canvas);
            pngBlobs.push(blob);
            pngNames.push(`${manualSel?.drawingNumber || `page-${pi + 1}`}.png`);
          }
        }
      }

      // ── Generate merged PDF via server (vector annotations added server-side) ──
      let pdfBlob = null;
      if (exportPdf && pdfPageData.length > 0) {
        setProgress('Generating PDF\u2026');
        const res = await fetch('/api/export-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pages: pdfPageData }),
        });
        if (!res.ok) throw new Error(`PDF generation failed (HTTP ${res.status})`);
        pdfBlob = new Blob([await res.arrayBuffer()], { type: 'application/pdf' });
      }

      // ── Build final output blob ──
      setProgress('Saving\u2026');
      let finalBlob;

      if (outputType === 'zip') {
        const zip = new JSZip();
        if (pdfBlob) zip.file(`${pdfBasename}.pdf`, pdfBlob);
        pngBlobs.forEach((blob, i) => zip.file(pngNames[i], blob));
        finalBlob = await zip.generateAsync({ type: 'blob' });
      } else if (outputType === 'pdf') {
        finalBlob = pdfBlob;
      } else {
        finalBlob = pngBlobs[0];
      }

      if (!finalBlob) throw new Error('Nothing to save');

      // ── Save: write to pre-opened handle, or fall back to download ──
      if (fileHandle) {
        await writeToHandle(fileHandle, finalBlob);
      } else {
        downloadBlob(finalBlob, suggestedName);
      }

      const parts = [];
      if (exportPdf && pdfBlob) parts.push('1 PDF');
      if (exportPng && pngBlobs.length > 0) parts.push(`${pngBlobs.length} PNG${pngBlobs.length !== 1 ? 's' : ''}`);
      setResult({ ok: true, msg: `Exported ${parts.join(' and ')}` });
    } catch (err) {
      console.error('Export error:', err);
      setResult({ ok: false, msg: `Export failed: ${err.message}` });
    } finally {
      setExporting(false);
      setProgress('');
    }
  }, [canExport, checkedDone, totalPages, filterByOptions, getOverride, exportPdf, exportPng, pins, finishesOverrides]);

  return (
    <div className="v-section">
      <button className="v-section-header" onClick={() => toggleCollapse(SECTION_KEY)}>
        <div className="v-section-left">
          <span className={`v-chevron ${isCollapsed ? 'v-chevron-closed' : ''}`}>&#9662;</span>
          <h3 className="v-section-title">Export Mark-ups</h3>
        </div>
        {checkedDone.length > 0 && (
          <div className="v-section-counts">
            <span className="sc-pass">{totalPages} page{totalPages !== 1 ? 's' : ''}</span>
          </div>
        )}
      </button>

      {!isCollapsed && (
        <div className="export-inline-body">

          {/* Two-column layout: Formats | Drawings */}
          <div className="export-cols">

            {/* Left: format checkboxes */}
            <div className="export-col">
              <div className="export-col-label">Formats</div>
              <label className="export-check-row">
                <input
                  type="checkbox"
                  checked={exportPdf}
                  onChange={e => setExportPdf(e.target.checked)}
                  disabled={exporting}
                />
                <div>
                  <div className="export-check-title">PDF (merged)</div>
                </div>
              </label>
              <label className="export-check-row">
                <input
                  type="checkbox"
                  checked={exportPng}
                  onChange={e => setExportPng(e.target.checked)}
                  disabled={exporting}
                />
                <div>
                  <div className="export-check-title">PNG (100 DPI)</div>
                  <div className="export-check-hint">one per page</div>
                </div>
              </label>
            </div>

            {/* Right: drawings list */}
            <div className="export-col">
              <div className="export-col-label">Drawings</div>
              {checkedDone.length === 0 ? (
                <p className="export-no-checks">No drawings selected.</p>
              ) : (
                <div className="export-drawings-list">
                  {checkedDone.map(pdf => (
                    <div key={pdf.id} className="export-drawing-item">
                      <span className="export-drawing-name" title={pdf.displayName}>
                        {pdf.displayName}
                      </span>
                      <span className="export-drawing-pages">{pdf.totalPages}p</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

          {/* Progress */}
          {exporting && (
            <div className="export-progress-row">
              <div className="spinner spinner-small" style={{ display: 'inline-block', marginRight: 6 }} />
              <span>{progress}</span>
            </div>
          )}

          {/* Result banner */}
          {result && (
            <div className={`export-result ${result.ok ? 'export-result-ok' : 'export-result-err'}`}>
              {result.msg}
            </div>
          )}

          {/* Export button */}
          <button
            className="export-run-btn-inline"
            onClick={handleExport}
            disabled={!canExport || exporting}
          >
            {exporting
              ? 'Exporting\u2026'
              : checkedDone.length === 0
              ? 'Export'
              : `Export (${totalPages} page${totalPages !== 1 ? 's' : ''})`}
          </button>

        </div>
      )}
    </div>
  );
}
