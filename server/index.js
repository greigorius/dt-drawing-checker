const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

// Log env presence on startup (not actual values)
console.log('=== Environment Check ===');
console.log(`  NOTION_API_KEY: ${process.env.NOTION_API_KEY ? 'SET (' + process.env.NOTION_API_KEY.length + ' chars)' : 'MISSING'}`);
console.log(`  NOTION_PROJECTS_DB_ID: ${process.env.NOTION_PROJECTS_DB_ID ? 'SET (' + process.env.NOTION_PROJECTS_DB_ID + ')' : 'MISSING'}`);
console.log(`  NOTION_DRAWING_SCHEDULE_DB_ID: ${process.env.NOTION_DRAWING_SCHEDULE_DB_ID ? 'SET (' + process.env.NOTION_DRAWING_SCHEDULE_DB_ID + ')' : 'MISSING'}`);
console.log(`  NOTION_FINISHES_DB_ID: ${process.env.NOTION_FINISHES_DB_ID ? 'SET (' + process.env.NOTION_FINISHES_DB_ID + ')' : 'MISSING'}`);
console.log('=========================');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ── Finishes database lookup by suffix number ──
app.post('/api/finishes-lookup', async (req, res) => {
  const { suffixNumber, projectPageId } = req.body;
  if (!suffixNumber) {
    return res.json({ rows: [], error: 'suffixNumber is required' });
  }

  const notionKey = process.env.NOTION_API_KEY;
  const databaseId = process.env.NOTION_FINISHES_DB_ID;

  if (!notionKey || !databaseId) {
    return res.json({ rows: [], error: 'Finishes database not configured' });
  }

  console.log(`\n=== Finishes Lookup: suffix="${suffixNumber}"${projectPageId ? `, projectPageId="${projectPageId}"` : ''} ===`);

  // Build filter: always filter by suffix; add project relation filter if we have the page ID
  const suffixFilter = {
    property: 'Suffix',
    rollup: { any: { rich_text: { equals: suffixNumber } } },
  };
  const filter = projectPageId
    ? { and: [suffixFilter, { property: 'Project', relation: { contains: projectPageId } }] }
    : suffixFilter;

  try {
    const response = await fetch(
      `https://api.notion.com/v1/databases/${databaseId}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${notionKey}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filter, page_size: 100 }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`  Finishes API error: HTTP ${response.status}: ${errorBody}`);
      return res.json({ rows: [], error: `Notion query failed (HTTP ${response.status})` });
    }

    const data = await response.json();
    const rows = (data.results || []).map((page) => {
      const p = page.properties;
      return {
        specRef: getNotionValue(p['Spec Ref']),
        cadRef: getNotionValue(p['CAD Ref']),
        finishDescription: getNotionValue(p['Finish Description']),
        sampleRef: getNotionValue(p['Sample Ref']),
        approved: getNotionValue(p['APPROVED']),
        pageId: page.id,
      };
    });

    console.log(`  Finishes: ${rows.length} row(s) found for suffix "${suffixNumber}"`);
    res.json({ rows, error: null });
  } catch (err) {
    console.error(`  Finishes lookup error: ${err.message}`);
    res.json({ rows: [], error: 'Finishes database could not be reached' });
  }
});

// ── Notion helper: extract property value ──
function getNotionValue(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case 'title':
      return prop.title?.map((t) => t.plain_text).join('') || null;
    case 'rich_text':
      return prop.rich_text?.map((t) => t.plain_text).join('') || null;
    case 'select':
      return prop.select?.name || null;
    case 'multi_select':
      return prop.multi_select?.map((s) => s.name).join(', ') || null;
    case 'date':
      return prop.date?.start || null;
    case 'number':
      return prop.number != null ? String(prop.number) : null;
    case 'formula':
      if (prop.formula?.type === 'string') return prop.formula.string || null;
      if (prop.formula?.type === 'number') return prop.formula.number != null ? String(prop.formula.number) : null;
      if (prop.formula?.type === 'boolean') return String(prop.formula.boolean);
      if (prop.formula?.type === 'date') return prop.formula.date?.start || null;
      return null;
    case 'rollup':
      if (prop.rollup?.type === 'array') {
        return prop.rollup.array?.map((item) => getNotionValue(item)).filter(Boolean).join(', ') || null;
      }
      if (prop.rollup?.type === 'number') return prop.rollup.number != null ? String(prop.rollup.number) : null;
      if (prop.rollup?.type === 'date') return prop.rollup.date?.start || null;
      return null;
    case 'relation':
      // Return comma-separated page IDs (useful for checking, not for display)
      return (prop.relation || []).map((r) => r.id).join(', ') || null;
    case 'people':
      return prop.people?.map((p) => p.name).filter(Boolean).join(', ') || null;
    case 'checkbox':
      return String(prop.checkbox);
    default:
      console.warn(`  Unknown Notion property type: "${prop.type}"`);
      return null;
  }
}

// ── Notion helper: map a Notion row to our internal format ──
function mapNotionRow(row) {
  const p = row.properties;
  return {
    project: getNotionValue(p['Project']),
    item: getNotionValue(p['Item']),
    assignedTo: (p['Person']?.relation || []).map(r => r.id).join(',') || null,
    suffixNumber: getNotionValue(p['Suffix #']),
    drawingNumber: getNotionValue(p['Drawing Number']),
    pageDescription: getNotionValue(p['Page Description']),
    drawingTitle1: getNotionValue(p['Drawing Title 1']),
    drawingTitle2: getNotionValue(p['Drawing Title 2']),
    drawingTitle3: getNotionValue(p['Drawing Title 3']),
    revision: getNotionValue(p['Rev']),
    s4Status: getNotionValue(p['S4 Status']),
    s4StatusDate: getNotionValue(p['S4 Status Date']),
    s4DtDeliveryDateActual: getNotionValue(p['S4 DT Delivery Date (Actual)']),
    s5Status: getNotionValue(p['S5 Status']),
    s5StatusDate: getNotionValue(p['S5 Status Date']),
    s5DtDeliveryDateActual: getNotionValue(p['S5 DT Delivery Date (Actual)']),
    designStage: getNotionValue(p['Design Stage']),
  };
}

// ── Export PDF: embed drawing image then draw vector annotations via pdf-lib ──
app.post('/api/export-pdf', async (req, res) => {
  const { pages } = req.body;
  if (!Array.isArray(pages) || pages.length === 0) {
    return res.status(400).json({ error: 'pages array is required' });
  }
  try {
    const exportDoc = await PDFDocument.create();
    const helvetica = await exportDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await exportDoc.embedFont(StandardFonts.HelveticaBold);

    const FAIL_RED   = rgb(0.86, 0.15, 0.15);
    const LABEL_GRAY = rgb(0.42, 0.45, 0.50);
    const WHITE      = rgb(1, 1, 1);
    const PIN_RADIUS = 8;    // points
    const CALLOUT_W  = 120;  // points
    const CALLOUT_H  = 28;   // points

    for (const { pngBase64, pageWidthPt, pageHeightPt, annotations = [], unplaced = [] } of pages) {
      const pngBytes = Buffer.from(pngBase64, 'base64');
      const pngImage = await exportDoc.embedPng(pngBytes);
      const page = exportDoc.addPage([pageWidthPt, pageHeightPt]);

      // Draw the rasterised drawing content at full page size
      page.drawImage(pngImage, { x: 0, y: 0, width: pageWidthPt, height: pageHeightPt });

      // ── Draw placed pin annotations as vector objects ──
      for (const ann of annotations) {
        const px = ann.x * pageWidthPt;
        const py = (1 - ann.y) * pageHeightPt;

        const calloutX = Math.max(10, px - CALLOUT_W - 12);
        const calloutY = Math.max(10, Math.min(pageHeightPt - CALLOUT_H - 10, py - CALLOUT_H / 2));

        // Callout box (white fill, red border)
        page.drawRectangle({
          x: calloutX, y: calloutY,
          width: CALLOUT_W, height: CALLOUT_H,
          color: WHITE, borderColor: FAIL_RED, borderWidth: 1,
        });

        // Field label (uppercase, grey)
        page.drawText(ann.label.toUpperCase(), {
          x: calloutX + 5, y: calloutY + CALLOUT_H - 11,
          font: helvetica, size: 5, color: LABEL_GRAY,
        });

        // Expected value (bold, red) — truncate to avoid overflow
        const expectedStr = ann.expected ? String(ann.expected).slice(0, 35) : '(none)';
        page.drawText(expectedStr, {
          x: calloutX + 5, y: calloutY + 5,
          font: helveticaBold, size: 6, color: FAIL_RED,
        });

        // Dashed connector: right edge of callout → left edge of pin circle
        page.drawLine({
          start: { x: calloutX + CALLOUT_W, y: py },
          end:   { x: px - PIN_RADIUS, y: py },
          thickness: 0.75, color: FAIL_RED,
          lineDashPattern: [4, 3],
        });

        // Pin circle (solid red)
        page.drawCircle({ x: px, y: py, size: PIN_RADIUS, color: FAIL_RED });

        // Pin number (white, centred in circle)
        const nStr = String(ann.n);
        const numFontSize = 7;
        const textWidth = helveticaBold.widthOfTextAtSize(nStr, numFontSize);
        page.drawText(nStr, {
          x: px - textWidth / 2,
          y: py - numFontSize * 0.35,
          font: helveticaBold, size: numFontSize, color: WHITE,
        });
      }

      // ── Unplaced fails: stacked list in top-right corner ──
      if (unplaced.length > 0) {
        const LIST_W = 130;
        const LIST_H = 28;
        const LIST_GAP = 4;
        const listX = pageWidthPt - LIST_W - 10;

        for (let i = 0; i < unplaced.length; i++) {
          const ann = unplaced[i];
          const boxY = pageHeightPt - 10 - (i + 1) * (LIST_H + LIST_GAP);

          page.drawRectangle({
            x: listX, y: boxY,
            width: LIST_W, height: LIST_H,
            color: WHITE, borderColor: FAIL_RED, borderWidth: 1,
          });

          const badgeX = listX + 10;
          const badgeY = boxY + LIST_H / 2;
          page.drawCircle({ x: badgeX, y: badgeY, size: 7, color: FAIL_RED });

          const nStr = String(ann.n);
          const nW = helveticaBold.widthOfTextAtSize(nStr, 6);
          page.drawText(nStr, {
            x: badgeX - nW / 2, y: badgeY - 6 * 0.35,
            font: helveticaBold, size: 6, color: WHITE,
          });

          page.drawText(ann.label.toUpperCase(), {
            x: listX + 22, y: boxY + LIST_H - 11,
            font: helvetica, size: 5, color: LABEL_GRAY,
          });
          const expStr = ann.expected ? String(ann.expected).slice(0, 22) : '(none)';
          page.drawText(expStr, {
            x: listX + 22, y: boxY + 5,
            font: helveticaBold, size: 6, color: FAIL_RED,
          });
        }
      }
    }

    const pdfBytes = await exportDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="export.pdf"');
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error('Export PDF error:', err);
    res.status(500).json({ error: 'PDF generation failed', message: err.message });
  }
});

// ── All projects endpoint ──
app.get('/api/notion-all-projects', async (req, res) => {
  const notionKey = process.env.NOTION_API_KEY;
  const databaseId = process.env.NOTION_PROJECTS_DB_ID;
  if (!notionKey || !databaseId) {
    return res.json({ projects: [], error: 'Projects database not configured' });
  }
  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${notionKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ page_size: 100 }),
    });
    if (!response.ok) {
      const body = await response.text();
      return res.json({ projects: [], error: `Notion query failed (HTTP ${response.status}): ${body}` });
    }
    const data = await response.json();
    const projects = (data.results || []).map(row => ({
      pageId: row.id,
      projectName: getNotionValue(row.properties['Project Name']),
      projectNumber: getNotionValue(row.properties['Project #']),
      projectAddress: getNotionValue(row.properties['Project Address']),
      mainContractor: getNotionValue(row.properties['Main Contractor']),
      architect: getNotionValue(row.properties['Architect']),
    })).filter(p => p.projectName);
    console.log(`[notion-all-projects] Returned ${projects.length} projects`);
    res.json({ projects, error: null });
  } catch (err) {
    console.error('[notion-all-projects] Error:', err.message);
    res.json({ projects: [], error: 'Projects database could not be reached' });
  }
});

// ── Unique suffixes (Items) for a project ──
// Filters Drawing Schedule by the `Project` formula string, then extracts unique
// {suffixNumber, itemPageId} pairs for the cascade suffix dropdown.
app.post('/api/notion-suffixes-for-project', async (req, res) => {
  const { projectName } = req.body;
  if (!projectName) {
    return res.status(400).json({ suffixes: [], error: 'projectName is required' });
  }
  const notionKey = process.env.NOTION_API_KEY;
  const databaseId = process.env.NOTION_DRAWING_SCHEDULE_DB_ID;
  if (!notionKey || !databaseId) {
    return res.json({ suffixes: [], error: 'Drawing Schedule database not configured' });
  }

  // The `Project` property is a formula string — use the first token of the name
  // (e.g. "24-367" from "24-367 - EIT Observation Hall") as a reliable contains filter.
  const projectIdentifier = projectName.split(' ')[0];
  console.log(`[notion-suffixes-for-project] Querying for project identifier "${projectIdentifier}"`);

  try {
    let allRows = [];
    let cursor = undefined;
    do {
      const body = {
        page_size: 100,
        filter: { property: 'Project', formula: { string: { contains: projectIdentifier } } },
        ...(cursor ? { start_cursor: cursor } : {}),
      };
      const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${notionKey}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errBody = await response.text();
        return res.json({ suffixes: [], error: `Notion query failed (HTTP ${response.status}): ${errBody}` });
      }
      const data = await response.json();
      allRows = allRows.concat(data.results || []);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    // Extract unique {suffixNumber, itemPageId} pairs
    const seen = new Set();
    const suffixes = [];
    for (const row of allRows) {
      const p = row.properties;
      const suffixNumber = getNotionValue(p['Suffix #']);
      const itemPageId = p['Item']?.relation?.[0]?.id || null;
      const key = itemPageId || suffixNumber;
      if (key && !seen.has(key)) {
        seen.add(key);
        suffixes.push({ suffixNumber, itemPageId });
      }
    }
    suffixes.sort((a, b) => (a.suffixNumber || '').localeCompare(b.suffixNumber || ''));
    console.log(`[notion-suffixes-for-project] ${suffixes.length} unique suffix/item pair(s) found`);
    res.json({ suffixes, error: null });
  } catch (err) {
    console.error('[notion-suffixes-for-project] Error:', err.message);
    res.json({ suffixes: [], error: 'Drawing Schedule database could not be reached' });
  }
});

// ── Drawing rows for a selected Item (for drawing number dropdown) ──
// Filters Drawing Schedule by `Item` relation — the true relation property.
app.post('/api/notion-drawings-for-project', async (req, res) => {
  const { itemPageId } = req.body;
  if (!itemPageId) {
    return res.status(400).json({ rows: [], error: 'itemPageId is required' });
  }
  const notionKey = process.env.NOTION_API_KEY;
  const databaseId = process.env.NOTION_DRAWING_SCHEDULE_DB_ID;
  if (!notionKey || !databaseId) {
    return res.json({ rows: [], error: 'Drawing Schedule database not configured' });
  }

  console.log(`[notion-drawings-for-project] Querying drawings for item ${itemPageId}`);

  try {
    let allRows = [];
    let cursor = undefined;
    do {
      const body = {
        page_size: 100,
        filter: { property: 'Item', relation: { contains: itemPageId } },
        sorts: [{ property: 'Drawing Number', direction: 'ascending' }],
        ...(cursor ? { start_cursor: cursor } : {}),
      };
      const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${notionKey}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errBody = await response.text();
        return res.json({ rows: [], error: `Notion query failed (HTTP ${response.status}): ${errBody}` });
      }
      const data = await response.json();
      allRows = allRows.concat((data.results || []).map(r => mapNotionRow(r)));
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
    console.log(`[notion-drawings-for-project] ${allRows.length} drawing row(s) for item ${itemPageId}`);
    res.json({ rows: allRows, error: null });
  } catch (err) {
    console.error('[notion-drawings-for-project] Error:', err.message);
    res.json({ rows: [], error: 'Drawing Schedule database could not be reached' });
  }
});


// ── Drawing lookup by drawing number (bypasses suffix chain) ──────────────────
app.post('/api/notion-drawing-by-number', async (req, res) => {
  const { drawingNo, projectNo } = req.body;
  if (!drawingNo) return res.json({ row: null, error: 'drawingNo is required' });

  const notionKey   = process.env.NOTION_API_KEY;
  const databaseId  = process.env.NOTION_DRAWING_SCHEDULE_DB_ID;
  if (!notionKey || !databaseId) return res.json({ row: null, error: 'Drawing Schedule not configured' });

  const filter = projectNo
    ? { and: [
        { property: 'Drawing Number', title: { equals: drawingNo } },
        { property: 'Project', formula: { string: { contains: projectNo } } },
      ]}
    : { property: 'Drawing Number', title: { equals: drawingNo } };

  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${notionKey}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter, page_size: 1 }),
    });
    if (!response.ok) return res.json({ row: null, error: `Notion query failed (${response.status})` });
    const data = await response.json();
    if (!data.results?.[0]) return res.json({ row: null });
    const rawRow = data.results[0];
    const row = mapNotionRow(rawRow);
    // Resolve Person relation to a name
    const personIds = rawRow.properties['Person']?.relation || [];
    if (personIds.length && notionKey) {
      try {
        const pr = await fetch(`https://api.notion.com/v1/pages/${personIds[0].id}`, {
          headers: { Authorization: `Bearer ${notionKey}`, 'Notion-Version': '2022-06-28' },
        });
        if (pr.ok) {
          const personPage = await pr.json();
          const titleProp = Object.values(personPage.properties || {}).find(p => p.type === 'title');
          row.assignedTo = titleProp?.title?.map(t => t.plain_text).join('') || null;
        }
      } catch { /* non-fatal */ }
    }
    res.json({ row });
  } catch (err) {
    res.json({ row: null, error: err.message });
  }
});


// ── Proxy a Dropbox share link (bypasses CORS) ───────────────────────────────
app.get('/api/proxy-pdf', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url is required' });

  // Convert dl=0 share link to direct download
  const dlUrl = url.includes('dl=0') ? url.replace('dl=0', 'dl=1')
              : url.includes('?')     ? url + '&dl=1'
              :                         url + '?dl=1';
  try {
    const r = await fetch(dlUrl, { redirect: 'follow' });
    if (!r.ok) return res.status(r.status).json({ error: `Dropbox fetch failed: ${r.status}` });
    const buffer = await r.arrayBuffer();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Drawing lookup by Notion page ID (most reliable — uses ADF drawingIds) ────
app.get('/api/notion-drawing-by-id', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.json({ row: null, error: 'id is required' });

  const notionKey = process.env.NOTION_API_KEY;
  if (!notionKey) return res.json({ row: null, error: 'NOTION_API_KEY not configured' });

  try {
    const response = await fetch(`https://api.notion.com/v1/pages/${id}`, {
      headers: { Authorization: `Bearer ${notionKey}`, 'Notion-Version': '2022-06-28' },
    });
    if (!response.ok) return res.json({ row: null, error: `Notion returned ${response.status}` });
    const page = await response.json();
    const row  = mapNotionRow(page);
    // Resolve Person relation
    const personIds = page.properties['Person']?.relation || [];
    if (personIds.length) {
      try {
        const pr = await fetch(`https://api.notion.com/v1/pages/${personIds[0].id}`, {
          headers: { Authorization: `Bearer ${notionKey}`, 'Notion-Version': '2022-06-28' },
        });
        if (pr.ok) {
          const personPage = await pr.json();
          const titleProp = Object.values(personPage.properties || {}).find(p => p.type === 'title');
          row.assignedTo = titleProp?.title?.map(t => t.plain_text).join('') || null;
        }
      } catch { /* non-fatal */ }
    }
    res.json({ row });
  } catch (err) {
    res.json({ row: null, error: err.message });
  }
});


// ── Annotate PDF (vector) ─────────────────────────────────────────────────────
// Takes the original PDF bytes + annotation data and adds vector overlays.
// No rasterization — output is smaller and fully resolution-independent.
app.post('/api/annotate-pdf', async (req, res) => {
  const { pdfBase64, annotations = [], sketchesByPage = {} } = req.body;
  if (!pdfBase64) return res.status(400).json({ error: 'pdfBase64 required' });

  try {
    const pdfBytes  = Buffer.from(pdfBase64, 'base64');
    const pdfDoc    = await PDFDocument.load(pdfBytes);
    const helvetica     = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const pages = pdfDoc.getPages();

    const FAIL_RED   = rgb(0.86, 0.15, 0.15);
    const LABEL_GRAY = rgb(0.42, 0.45, 0.50);
    const WHITE      = rgb(1, 1, 1);
    const YELLOW     = rgb(1, 0.90, 0);

    for (let pi = 0; pi < pages.length; pi++) {
      const page = pages[pi];
      const { width: pw, height: ph } = page.getSize();
      // pdf-lib Y=0 is bottom; canvas Y=0 is top — flip Y
      const fy = (fracY) => ph - fracY * ph;
      const fx = (fracX) => fracX * pw;

      // ── Sketch objects ──
      const sketches = sketchesByPage[pi] || [];
      for (const obj of sketches) {
        try {
          switch (obj.type) {
            case 'rect': {
              const [r2,g2,b2] = hexToRgb(obj.color);
              page.drawRectangle({
                x: Math.min(fx(obj.x1), fx(obj.x2)),
                y: Math.min(fy(obj.y1), fy(obj.y2)),
                width: Math.abs(fx(obj.x2) - fx(obj.x1)),
                height: Math.abs(fy(obj.y2) - fy(obj.y1)),
                borderColor: rgb(r2,g2,b2), borderWidth: obj.width || 1, color: undefined,
              });
              break;
            }
            case 'highlight': {
              page.drawRectangle({
                x: Math.min(fx(obj.x1), fx(obj.x2)),
                y: Math.min(fy(obj.y1), fy(obj.y2)),
                width: Math.abs(fx(obj.x2) - fx(obj.x1)),
                height: Math.abs(fy(obj.y2) - fy(obj.y1)),
                color: rgb(1, 0.90, 0), opacity: 0.35,
              });
              break;
            }
            case 'line':
            case 'arrow': {
              const [r2,g2,b2] = hexToRgb(obj.color);
              page.drawLine({ start: { x: fx(obj.x1), y: fy(obj.y1) }, end: { x: fx(obj.x2), y: fy(obj.y2) }, thickness: obj.width || 1, color: rgb(r2,g2,b2) });
              break;
            }
            case 'ellipse': {
              const [r2,g2,b2] = hexToRgb(obj.color);
              page.drawEllipse({ x: fx(obj.cx), y: fy(obj.cy), xScale: obj.rx * pw, yScale: obj.ry * ph, borderColor: rgb(r2,g2,b2), borderWidth: obj.width || 1, color: undefined });
              break;
            }
            case 'text': {
              const [r2,g2,b2] = hexToRgb(obj.color);
              const fs = Math.max(6, (obj.fontSizeFrac || 0.025) * ph);
              page.drawText(obj.content || '', { x: fx(obj.x), y: fy(obj.y) - fs, font: helvetica, size: fs, color: rgb(r2,g2,b2) });
              break;
            }
          }
        } catch { /* skip broken sketch object */ }
      }

      // ── Pin annotations ──
      const pageAnns = annotations.filter(a => a.pageIndex === pi);
      const PIN_R = 8, CW = 120, CH = 24;
      for (const ann of pageAnns) {
        if (ann.x == null || ann.y == null) continue;
        const px2 = fx(ann.x), py2 = fy(ann.y);
        const cxLeft = Math.max(10, px2 - CW - 10);
        const cyBottom = Math.max(10, py2 - CH / 2);
        // Callout box
        page.drawRectangle({ x: cxLeft, y: cyBottom, width: CW, height: CH, color: WHITE, borderColor: FAIL_RED, borderWidth: 1 });
        page.drawText((ann.label || '').toUpperCase(), { x: cxLeft + 4, y: cyBottom + CH - 9, font: helvetica, size: 5, color: LABEL_GRAY });
        page.drawText(String(ann.expected || '(none)').slice(0, 30), { x: cxLeft + 4, y: cyBottom + 4, font: helveticaBold, size: 6, color: FAIL_RED });
        // Connector line
        page.drawLine({ start: { x: cxLeft + CW, y: py2 }, end: { x: px2 - PIN_R, y: py2 }, thickness: 0.75, color: FAIL_RED });
        // Pin circle
        page.drawCircle({ x: px2, y: py2, size: PIN_R, color: FAIL_RED });
        const nStr = String(ann.n || '');
        const nW = helveticaBold.widthOfTextAtSize(nStr, 7);
        page.drawText(nStr, { x: px2 - nW / 2, y: py2 - 2.5, font: helveticaBold, size: 7, color: WHITE });
      }

      // ── Unplaced pins (top-right list) ──
      const unplaced = annotations.filter(a => a.pageIndex === pi && a.x == null);
      const LW = 130, LH = 24, LG = 4;
      const listX = pw - LW - 10;
      unplaced.forEach((ann, i) => {
        const boxY = ph - 10 - (i + 1) * (LH + LG);
        page.drawRectangle({ x: listX, y: boxY, width: LW, height: LH, color: WHITE, borderColor: FAIL_RED, borderWidth: 1 });
        page.drawCircle({ x: listX + 9, y: boxY + LH / 2, size: 7, color: FAIL_RED });
        const nStr = String(ann.n || '');
        const nW = helveticaBold.widthOfTextAtSize(nStr, 6);
        page.drawText(nStr, { x: listX + 9 - nW / 2, y: boxY + LH / 2 - 2, font: helveticaBold, size: 6, color: WHITE });
        page.drawText((ann.label || '').toUpperCase(), { x: listX + 20, y: boxY + LH - 9, font: helvetica, size: 5, color: LABEL_GRAY });
        page.drawText(String(ann.expected || '(none)').slice(0, 20), { x: listX + 20, y: boxY + 4, font: helveticaBold, size: 6, color: FAIL_RED });
      });
    }

    const outBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.send(Buffer.from(outBytes));
  } catch (err) {
    console.error('[annotate-pdf]', err.message);
    res.status(500).json({ error: err.message });
  }
});

function hexToRgb(hex) {
  const h = (hex || '#000000').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c=>c+c).join('') : h, 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

// ── Load Pending: proxy ADF submissions list ──────────────
const ADF_BASE_URL = process.env.ADF_BASE_URL || 'https://axiom-drawing-flow.netlify.app';

app.get('/api/df-submissions', async (req, res) => {
  try {
    const r = await fetch(`${ADF_BASE_URL}/api/df/submissions?status=Submitted`);
    if (!r.ok) throw new Error(`ADF returned ${r.status}`);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error('[df-submissions]', err.message);
    res.status(500).json({ submissions: [], error: err.message });
  }
});

// ── Load Pending: serve a local Dropbox file ────────────────
// root: absolute path to the folder containing "Drawing Submissions/" (passed from client)
// path: relative path from ADF, e.g. "Drawing Submissions/24-367/A4.5/Pending/file.pdf"
// Falls back to DROPBOX_LOCAL_PATH env var if root is not provided by client.
app.get('/api/local-pdf', (req, res) => {
  const localRoot = process.env.DROPBOX_LOCAL_PATH;

  if (!localRoot) {
    return res.status(503).json({
      error: 'DROPBOX_LOCAL_PATH not set in server/.env',
    });
  }

  const relPath = req.query.path;
  if (!relPath) return res.status(400).json({ error: 'path query param required' });

  const safePath = path.resolve(localRoot, relPath.replace(/\//g, path.sep));
  if (!safePath.startsWith(path.resolve(localRoot))) {
    return res.status(403).json({ error: 'Path traversal not allowed' });
  }
  if (!fs.existsSync(safePath)) {
    return res.status(404).json({ error: 'File not found', resolved: safePath });
  }

  const filename = path.basename(safePath);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  fs.createReadStream(safePath).pipe(res);
});

// ── Scan local Dropbox Pending folders ──────────────────────────────────
// Returns all PDFs found in Drawing Submissions/{proj}/{stage}/Pending/
// Uses DROPBOX_LOCAL_PATH from server/.env
app.get('/api/scan-pending', (req, res) => {
  const localRoot = process.env.DROPBOX_LOCAL_PATH;
  if (!localRoot) {
    return res.status(503).json({ files: [], error: 'DROPBOX_LOCAL_PATH not set in server/.env' });
  }

  const drawingRoot = path.join(localRoot, 'Drawing Submissions');
  if (!fs.existsSync(drawingRoot)) {
    return res.status(404).json({ files: [], error: `Not found: ${drawingRoot}` });
  }

  try {
    const files = [];
    const projects = fs.readdirSync(drawingRoot, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name);

    for (const projectNo of projects) {
      const projPath = path.join(drawingRoot, projectNo);
      const stages = fs.readdirSync(projPath, { withFileTypes: true })
        .filter(d => d.isDirectory()).map(d => d.name);

      for (const stage of stages) {
        const pendingPath = path.join(projPath, stage, 'Pending');
        if (!fs.existsSync(pendingPath)) continue;

        const pdfs = fs.readdirSync(pendingPath)
          .filter(f => f.toLowerCase().endsWith('.pdf') && !f.startsWith('.'));

        for (const filename of pdfs) {
          const base = filename.replace(/\.pdf$/i, '');
          const parts = base.split('_');
          const itemNo   = parts[0] || '';
          const drawingNo  = parts[1] || '';
          const revision   = parts[2] || '';
          const stat = fs.statSync(path.join(pendingPath, filename));
          const submittedDate = stat.mtime.toISOString().split('T')[0];
          files.push({
            filename,
            dropboxPath: `Drawing Submissions/${projectNo}/${stage}/Pending/${filename}`,
            taskCode: itemNo ? `${projectNo}-${itemNo}` : projectNo,
            revision,
            drawingNo,
            stage: stage.toUpperCase(),
            submittedDate,
            submissionId: null,
          });
        }
      }
    }

    console.log(`[scan-pending] Found ${files.length} PDF(s)`);
    res.json({ files });
  } catch (err) {
    console.error('[scan-pending]', err.message);
    res.status(500).json({ files: [], error: err.message });
  }
});

// ── Dropbox chunked upload proxy ────────────────────────────────────────────
// Three-step session upload: start → append (×N) → finish
// Op selected by X-Upload-Op header. No PDF bytes ever sent to ADF or Make.

const DROPBOX_API = 'https://content.dropboxapi.com/2/files';

// ── Auto-refreshing token (uses refresh_token if set, falls back to static token) ──
let _dbxToken = null;
let _dbxTokenExpiry = 0;

async function getDropboxToken() {
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  if (!refreshToken) {
    // Legacy: static access token (expires every 4h — set DROPBOX_REFRESH_TOKEN to fix)
    return process.env.DROPBOX_ACCESS_TOKEN || null;
  }
  const now = Date.now();
  if (_dbxToken && now < _dbxTokenExpiry - 300_000) return _dbxToken; // cached, 5-min buffer
  const appKey    = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;
  if (!appKey || !appSecret) throw new Error('DROPBOX_APP_KEY / DROPBOX_APP_SECRET not set');
  const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: appKey, client_secret: appSecret }),
  });
  if (!r.ok) throw new Error(`Dropbox token refresh failed: ${r.status}`);
  const d = await r.json();
  _dbxToken       = d.access_token;
  _dbxTokenExpiry = now + d.expires_in * 1000;
  console.log('[dropbox] Token refreshed, expires in', Math.round(d.expires_in / 60), 'min');
  return _dbxToken;
}

async function dropboxReq(path, apiArg, body, token) {
  const r = await fetch(`${DROPBOX_API}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify(apiArg),
      'Content-Type': 'application/octet-stream',
    },
    body,
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

app.post('/api/dropbox-upload', async (req, res, next) => {
  let token;
  try { token = await getDropboxToken(); } catch (e) { return res.status(503).json({ error: e.message }); }
  if (!token) return res.status(503).json({ error: 'Dropbox token not configured (set DROPBOX_REFRESH_TOKEN or DROPBOX_ACCESS_TOKEN)' });

  const op = (req.headers['x-upload-op'] || '').toLowerCase();

  if (op === 'start') {
    const { ok, data } = await dropboxReq('/upload_session/start', { close: false }, '', token);
    if (!ok) return res.status(502).json({ error: data.error_summary || 'Dropbox start failed' });
    return res.json({ sessionId: data.session_id });
  }

  if (op === 'finish') {
    const { sessionId, offset, dropboxPath } = req.body;
    if (!sessionId || !dropboxPath) return res.status(400).json({ error: 'sessionId and dropboxPath required' });
    const { ok, data } = await dropboxReq(
      '/upload_session/finish',
      { cursor: { session_id: sessionId, offset: offset || 0 }, commit: { path: dropboxPath, mode: 'overwrite', autorename: false } },
      '',
      token
    );
    if (!ok) return res.status(502).json({ error: data.error_summary || 'Finish failed' });
    return res.json({ ok: true, dropboxPath: data.path_display });
  }

  // Append — binary body, bypass JSON middleware via raw handler
  next();
}, (err, req, res, next) => next(err));  // placeholder; append handled below

app.post('/api/dropbox-upload',
  express.raw({ limit: '5mb', type: 'application/octet-stream' }),
  async (req, res) => {
    let token;
    try { token = await getDropboxToken(); } catch (e) { return res.status(503).json({ error: e.message }); }
    if (!token) return res.status(503).json({ error: 'Dropbox token not configured' });

    const op = (req.headers['x-upload-op'] || '').toLowerCase();
    if (op !== 'append') return res.status(400).json({ error: `Unknown op: ${op}` });

    const sessionId = req.headers['x-session-id'];
    const offset    = parseInt(req.headers['x-offset'] || '0', 10);
    if (!sessionId) return res.status(400).json({ error: 'X-Session-Id required' });

    const { ok, data } = await dropboxReq(
      '/upload_session/append_v2',
      { cursor: { session_id: sessionId, offset }, close: false },
      req.body,
      token
    );
    if (!ok) return res.status(502).json({ error: data.error_summary || 'Append failed' });
    res.json({ ok: true });
  }
);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
