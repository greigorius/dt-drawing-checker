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
    assignedTo: getNotionValue(p['Person']),
    suffixNumber: getNotionValue(p['Suffix #']),
    drawingNumber: getNotionValue(p['Drawing Number']),
    pageDescription: getNotionValue(p['Page Description']),
    drawingTitle1: getNotionValue(p['Drawing Title 1']),
    drawingTitle2: getNotionValue(p['Drawing Title 2']),
    drawingTitle3: getNotionValue(p['Drawing Title 3']),
    revision: getNotionValue(p['Rev']),
    s4Status: getNotionValue(p['S4 Status (LOR)']),
    s4StatusDate: getNotionValue(p['S4 Status Date (LOR)']),
    s4DtDeliveryDateActual: getNotionValue(p['S4 DT Delivery Date (Actual)']),
    s5Status: getNotionValue(p['S5 Status (F&P)']),
    s5StatusDate: getNotionValue(p['S5 Status Date (F&P)']),
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

// ── Load Pending: proxy ADF submissions list ───────────────────────────