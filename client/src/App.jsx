import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { getSectionSummary } from './validationRules';
import { DEFAULT_CHECK_OPTIONS, loadCheckOptions, saveCheckOptions } from './settingsDefaults';
import PdfViewer from './PdfViewer';
import ExportSection from './ExportModal';
import './App.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

// ── Unique ID generator ──
let _idCounter = 0;
function makeId() {
  return `pdf-${Date.now()}-${++_idCounter}`;
}

// ── Issued For dropdown options (hardcoded, alphabetical) ──
const ISSUED_FOR_OPTIONS = [
  { value: 'A4.5', label: 'A4.5 - AUTHORISED MFG. and CONST. DESIGN' },
  { value: 'APPROVAL', label: 'APPROVAL' },
  { value: 'AS BUILT', label: 'AS BUILT' },
  { value: 'CONSTRUCTION', label: 'CONSTRUCTION' },
  { value: 'INFORMATION', label: 'INFORMATION' },
  { value: 'S4', label: 'S4 - FOR REVIEW AND AUTHORISATION' },
  { value: 'S5', label: 'S5 - FOR REVIEW AND ACCEPTANCE' },
];

// Static field order for pin numbering (must match validation section render order)
const STATIC_FIELD_ORDER = [
  // Project Details
  'projectName', 'projectNumber', 'clientName',
  // Drawing Data
  'suffixNumber', 'drawingNumber', 'drawingTitle', 'drawingTitle2', 'drawingTitle3', 'revision',
  // Drawing Status
  'issuedFor', 'status', 'statusBy', 'statusDate', 'author',
  // Revision Table
  'revtable-revision', 'revtable-description', 'revtable-date',
];

// Build validation result arrays from manual selections (all default to 'pass')
function buildPageResults(manualProject, manualSel) {
  const issuedFor = manualSel?.issuedFor;
  const issuedForLabel = ISSUED_FOR_OPTIONS.find(o => o.value === issuedFor)?.label || null;
  const statusBy =
    issuedFor === 'S5' ? manualProject?.mainContractor :
    issuedFor === 'A4.5' ? manualProject?.architect :
    issuedFor === 'CONSTRUCTION' ? manualProject?.mainContractor : null;

  // S5 drawings use S4 Notion properties; A4.5/Construction use S5 Notion properties
  const useS4Fields = issuedFor === 'S5';
  const useS5Fields = issuedFor === 'A4.5' || issuedFor === 'CONSTRUCTION';
  const statusVal = useS4Fields ? (manualSel?.notionRow?.s4Status || null)
    : useS5Fields ? (manualSel?.notionRow?.s5Status || null)
    : null;
  const statusDateVal = useS4Fields ? (manualSel?.notionRow?.s4StatusDate || null)
    : useS5Fields ? (manualSel?.notionRow?.s5StatusDate || null)
    : null;

  const s1 = [
    { field: 'projectName',   label: 'Project Name',   expected: manualProject?.projectName    || null, status: 'pass' },
    { field: 'projectNumber', label: 'Project Number', expected: manualProject?.projectNumber  || null, status: 'pass' },
    { field: 'clientName',    label: 'Client Name',    expected: manualProject?.mainContractor || null, status: 'pass' },
  ];

  const s2 = [
    { field: 'suffixNumber',  label: 'Suffix Number',    expected: manualSel?.suffixNumber                    || null, status: 'pass' },
    { field: 'drawingNumber', label: 'Drawing Number',   expected: manualSel?.drawingNumber                   || null, status: 'pass' },
    { field: 'drawingTitle',  label: 'Drawing Title 1',  expected: manualSel?.notionRow?.drawingTitle1        || null, status: 'pass' },
    { field: 'drawingTitle2', label: 'Drawing Title 2',  expected: manualSel?.notionRow?.drawingTitle2        || null, status: 'pass' },
    { field: 'drawingTitle3', label: 'Drawing Title 3',  expected: manualSel?.notionRow?.drawingTitle3        || null, status: 'pass' },
    { field: 'revision',      label: 'Revision',         expected: manualSel?.notionRow?.revision             || null, status: 'pass' },
  ];

  const s3 = [
    { field: 'issuedFor',  label: 'Issued For',  expected: issuedForLabel, status: 'pass' },
    { field: 'status',     label: 'Status',      expected: statusVal,      status: 'pass' },
    { field: 'statusBy',   label: 'Status By',   expected: statusBy,       status: 'pass' },
    { field: 'statusDate', label: 'Status Date', expected: statusDateVal,   status: 'pass' },
    { field: 'author',     label: 'Author',      expected: manualSel?.notionRow?.assignedTo || null, status: 'pass' },
  ];

  return { s1, s2, s3 };
}

function App() {

  // ── Multi-PDF state ──
  const [pdfs, setPdfs] = useState([]);
  const [selectedPdfId, setSelectedPdfId] = useState(null);
  const [selectedPage, setSelectedPage] = useState(0);
  const [loadingPending, setLoadingPending] = useState(false);

  // ── Notion projects (loaded on mount for project dropdown) ──
  const [notionProjects, setNotionProjects] = useState(null);
  const [notionProjectsError, setNotionProjectsError] = useState(null);

  // Upload
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [processingError, setProcessingError] = useState(null);
  const fileInputRef = useRef(null);
  const addFileInputRef = useRef(null);
  const uploadedFilesRef = useRef(new Map());

  // PDF list drag-to-reorder state
  const [dragListItemId, setDragListItemId] = useState(null);
  const [dragOverItemId, setDragOverItemId] = useState(null);

  // Right panel
  const [rightPanelTab, setRightPanelTab] = useState('page');
  const [checkOptions, setCheckOptions] = useState(() => loadCheckOptions());

  // PDF viewer
  const [pdfScale, setPdfScale] = useState(null);

  // Pin system — { [pdfId]: { [pageIndex]: { [field]: { x, y } } } }
  const [pins, setPins] = useState({});

  // Which field is currently active
  const [activeField, setActiveField] = useState(null);

  const detailsScrollRef = useRef(null);

  // Collapsed sections state
  const [collapsed, setCollapsed] = useState({ 'export-markups': true });

  const toggleCollapse = (key) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Status overrides — keyed by "pdfId-pageIndex-field", value: 'pass' | 'warning' | 'fail'
  const [statusOverrides, setStatusOverrides] = useState({});

  // Finishes overrides — keyed by "pdfId-rowIndex", value: 'pass' | 'warning' | 'fail'
  const [finishesOverrides, setFinishesOverrides] = useState({});

  const setStatusOverride = useCallback((pdfId, pageIndex, field, status) => {
    setStatusOverrides(prev => ({ ...prev, [`${pdfId}-${pageIndex}-${field}`]: status }));
    // If overriding TO fail: ensure a pin exists at default position
    if (status === 'fail') {
      setPins(prev => {
        if (prev[pdfId]?.[pageIndex]?.[field]) return prev;
        const pageKey = prev[pdfId]?.[pageIndex] || {};
        return { ...prev, [pdfId]: { ...(prev[pdfId] || {}), [pageIndex]: { ...pageKey, [field]: { x: 0.80, y: 0.50 } } } };
      });
    }
  }, []);

  const clearStatusOverride = useCallback((pdfId, pageIndex, field) => {
    setStatusOverrides(prev => {
      const next = { ...prev };
      delete next[`${pdfId}-${pageIndex}-${field}`];
      return next;
    });
  }, []);

  const getStatusOverride = useCallback((pdfId, pageIndex, field) => {
    return statusOverrides[`${pdfId}-${pageIndex}-${field}`] ?? null;
  }, [statusOverrides]);

  const setFinishesOverride = useCallback((pdfId, rowIndex, status) => {
    setFinishesOverrides(prev => ({ ...prev, [`${pdfId}-${rowIndex}`]: status }));
    if (status === 'fail') {
      const field = `finishes-row-${rowIndex}`;
      setPins(prev => {
        if (prev[pdfId]?.[0]?.[field]) return prev;
        const pageKey = prev[pdfId]?.[0] || {};
        return { ...prev, [pdfId]: { ...(prev[pdfId] || {}), 0: { ...pageKey, [field]: { x: 0.80, y: Math.min(0.50 + rowIndex * 0.04, 0.97) } } } };
      });
    }
  }, []);

  const clearFinishesOverride = useCallback((pdfId, rowIndex) => {
    setFinishesOverrides(prev => {
      const next = { ...prev };
      delete next[`${pdfId}-${rowIndex}`];
      return next;
    });
  }, []);

  const getFinishesOverride = useCallback((pdfId, rowIndex) => {
    return finishesOverrides[`${pdfId}-${rowIndex}`] ?? null;
  }, [finishesOverrides]);

  // ── Manual selection helpers ──

  const setManualProject = useCallback(async (pdfId, project) => {
    setPdfs(prev => prev.map(p => p.id !== pdfId ? p : {
      ...p,
      manualProject: project,
      availableProjectSuffixes: null,
      availableProjectDrawings: null,
      projectSuffixesLoading: project ? true : false,
      projectDrawingsLoading: false,
      manualSelections: p.manualSelections.map(s => s ? { ...s, suffixNumber: null, itemPageId: null, drawingNumber: null, notionRow: null, issuedFor: s.issuedFor } : s),
    }));
    if (!project) return;
    try {
      const res = await fetch('/api/notion-suffixes-for-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName: project.projectName }),
      });
      const data = await res.json();
      setPdfs(prev => prev.map(p => p.id !== pdfId ? p : {
        ...p,
        availableProjectSuffixes: data.suffixes || [],
        projectSuffixesLoading: false,
      }));
    } catch {
      setPdfs(prev => prev.map(p => p.id !== pdfId ? p : {
        ...p,
        availableProjectSuffixes: [],
        projectSuffixesLoading: false,
      }));
    }
  }, []);

  const setManualSuffix = useCallback(async (pdfId, pageIndex, suffixNumber, itemPageId) => {
    // Store suffix selection and clear downstream, then load drawings for this item
    setPdfs(prev => prev.map(p => {
      if (p.id !== pdfId) return p;
      const sel = [...(p.manualSelections || [])];
      sel[pageIndex] = { ...(sel[pageIndex] || {}), suffixNumber, itemPageId, drawingNumber: null, notionRow: null };
      return { ...p, manualSelections: sel, availableProjectDrawings: null, projectDrawingsLoading: true };
    }));
    if (!itemPageId) {
      setPdfs(prev => prev.map(p => p.id !== pdfId ? p : { ...p, availableProjectDrawings: [], projectDrawingsLoading: false }));
      return;
    }
    try {
      const res = await fetch('/api/notion-drawings-for-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemPageId }),
      });
      const data = await res.json();
      setPdfs(prev => prev.map(p => p.id !== pdfId ? p : {
        ...p,
        availableProjectDrawings: data.rows || [],
        projectDrawingsLoading: false,
      }));
    } catch {
      setPdfs(prev => prev.map(p => p.id !== pdfId ? p : {
        ...p,
        availableProjectDrawings: [],
        projectDrawingsLoading: false,
      }));
    }
  }, [pdfs]);

  const setManualPageSelection = useCallback((pdfId, pageIndex, updates) => {
    setPdfs(prev => prev.map(p => {
      if (p.id !== pdfId) return p;
      const sel = [...(p.manualSelections || [])];
      sel[pageIndex] = { ...(sel[pageIndex] || {}), ...updates };
      return { ...p, manualSelections: sel };
    }));
  }, []);

  const setRevisionTableDate = useCallback((pdfId, pageIndex, date) => {
    setPdfs(prev => prev.map(p => {
      if (p.id !== pdfId) return p;
      return { ...p, revisionTableDates: { ...p.revisionTableDates, [pageIndex]: date } };
    }));
  }, []);

  // ── Finishes lookup ──

  const triggerFinishesLookup = useCallback(async (pdfId, suffixNumber, projectPageId) => {
    if (!suffixNumber) {
      setPdfs(prev => prev.map(p => p.id === pdfId ? { ...p, finishesRows: [], finishesError: null } : p));
      return;
    }
    setPdfs(prev => prev.map(p => p.id === pdfId ? { ...p, finishesRows: null, finishesError: null } : p));
    try {
      const res = await fetch('/api/finishes-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suffixNumber, projectPageId }),
      });
      const data = await res.json();
      setPdfs(prev => prev.map(p => p.id === pdfId ? { ...p, finishesRows: data.rows || [], finishesError: data.error || null } : p));
    } catch {
      setPdfs(prev => prev.map(p => p.id === pdfId ? { ...p, finishesRows: [], finishesError: 'Lookup failed' } : p));
    }
  }, []);

  const refreshFinishes = useCallback(async (pdfId) => {
    const pdf = pdfs.find(p => p.id === pdfId);
    const suffixNumber = pdf?.manualSelections?.[0]?.suffixNumber;
    const projectPageId = pdf?.manualProject?.pageId;
    await triggerFinishesLookup(pdfId, suffixNumber, projectPageId);
  }, [pdfs, triggerFinishesLookup]);

  // ── Notion data refresh (re-fetches project list, drawing rows, finishes — does NOT touch overrides/pins) ──

  const refreshNotionData = useCallback(async (pdfId) => {
    const pdf = pdfs.find(p => p.id === pdfId);
    if (!pdf) return;

    setPdfs(prev => prev.map(p => p.id !== pdfId ? p : { ...p, notionRefreshing: true }));

    // Always refresh global project list
    try {
      const projRes = await fetch('/api/notion-all-projects');
      const projData = await projRes.json();
      setNotionProjects(projData.projects || []);
    } catch {}

    if (pdf.manualProject) {
      try {
        // Refresh suffixes list
        const suffRes = await fetch('/api/notion-suffixes-for-project', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectName: pdf.manualProject.projectName }),
        });
        const suffData = await suffRes.json();
        setPdfs(prev => prev.map(p => p.id !== pdfId ? p : { ...p, availableProjectSuffixes: suffData.suffixes || [] }));

        // Refresh drawings if a suffix/item is already selected
        const page0sel = pdf.manualSelections?.[0];
        if (page0sel?.itemPageId) {
          const drawRes = await fetch('/api/notion-drawings-for-project', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemPageId: page0sel.itemPageId }),
          });
          const data = await drawRes.json();
          const newRows = data.rows || [];

          setPdfs(prev => prev.map(p => {
            if (p.id !== pdfId) return p;
            // Re-link each page's notionRow to the refreshed data
            const newSelections = (p.manualSelections || []).map(sel => {
              if (!sel || !sel.drawingNumber) return sel;
              const fresh = newRows.find(r => r.drawingNumber === sel.drawingNumber);
              return fresh ? { ...sel, notionRow: fresh } : sel;
            });
            return { ...p, availableProjectDrawings: newRows, notionRefreshing: false, manualSelections: newSelections };
          }));
        } else {
          setPdfs(prev => prev.map(p => p.id !== pdfId ? p : { ...p, notionRefreshing: false }));
        }

        // Refresh finishes if suffix is set on page 0
        const suffixNumber = pdf.manualSelections?.[0]?.suffixNumber;
        if (suffixNumber) {
          await triggerFinishesLookup(pdfId, suffixNumber, pdf.manualProject.pageId);
        }
      } catch {
        setPdfs(prev => prev.map(p => p.id !== pdfId ? p : { ...p, notionRefreshing: false }));
      }
    } else {
      setPdfs(prev => prev.map(p => p.id !== pdfId ? p : { ...p, notionRefreshing: false }));
    }
  }, [pdfs, triggerFinishesLookup]);

  // ── Custom fields helpers ──

  const addCustomField = useCallback((pdfId, pageIndex, section) => {
    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setPdfs(prev => prev.map(p => {
      if (p.id !== pdfId) return p;
      const existing = p.customFields?.[pageIndex] || [];
      return { ...p, customFields: { ...p.customFields, [pageIndex]: [...existing, { id, section, expected: '' }] } };
    }));
  }, []);

  const removeCustomField = useCallback((pdfId, pageIndex, fieldId) => {
    setPdfs(prev => prev.map(p => {
      if (p.id !== pdfId) return p;
      const existing = p.customFields?.[pageIndex] || [];
      return { ...p, customFields: { ...p.customFields, [pageIndex]: existing.filter(f => f.id !== fieldId) } };
    }));
    // Clear override for removed field
    clearStatusOverride(pdfId, pageIndex, fieldId);
  }, [clearStatusOverride]);

  const updateCustomField = useCallback((pdfId, pageIndex, fieldId, updates) => {
    setPdfs(prev => prev.map(p => {
      if (p.id !== pdfId) return p;
      const existing = p.customFields?.[pageIndex] || [];
      return { ...p, customFields: { ...p.customFields, [pageIndex]: existing.map(f => f.id === fieldId ? { ...f, ...updates } : f) } };
    }));
  }, []);

  // ── Derived values ──

  const selectedPdf = useMemo(
    () => pdfs.find((p) => p.id === selectedPdfId) || null,
    [pdfs, selectedPdfId]
  );

  const activePdfDoc = selectedPdf?.pdfDoc || null;
  const activeTotalPages = selectedPdf?.totalPages || 0;

  // Filter validation results by check options
  const filterByOptions = useCallback((results) => {
    return results.filter((r) => checkOptions[r.field] !== false);
  }, [checkOptions]);

  // Compute per-PDF aggregate status from overrides only
  const getPdfStatus = useCallback((pdf) => {
    const prefix = `${pdf.id}-`;
    let hasWarning = false;
    for (const [key, val] of Object.entries(statusOverrides)) {
      if (!key.startsWith(prefix)) continue;
      if (val === 'fail') return 'fail';
      if (val === 'warning') hasWarning = true;
    }
    for (let fi = 0; fi < (pdf.finishesRows?.length || 0); fi++) {
      const s = getFinishesOverride(pdf.id, fi);
      if (s === 'fail') return 'fail';
      if (s === 'warning') hasWarning = true;
    }
    // Check custom fields
    for (let pi = 0; pi < pdf.totalPages; pi++) {
      for (const cf of (pdf.customFields?.[pi] || [])) {
        const s = statusOverrides[`${pdf.id}-${pi}-${cf.id}`];
        if (s === 'fail') return 'fail';
        if (s === 'warning') hasWarning = true;
      }
    }
    return hasWarning ? 'warning' : null;
  }, [statusOverrides, getFinishesOverride, finishesOverrides]);

  // Overall summary across all PDFs
  const overallStatus = useMemo(() => {
    if (pdfs.length === 0) return null;
    const counts = { pass: 0, warning: 0, fail: 0 };
    for (const [, val] of Object.entries(statusOverrides)) {
      if (val in counts) counts[val]++;
    }
    for (const [, val] of Object.entries(finishesOverrides)) {
      if (val in counts) counts[val]++;
    }
    if (counts.pass + counts.warning + counts.fail === 0) return null;
    let status = 'pass';
    if (counts.fail > 0) status = 'fail';
    else if (counts.warning > 0) status = 'warning';
    return { ...counts, status, total: pdfs.length };
  }, [pdfs.length, statusOverrides, finishesOverrides]);

  // Current page results (computed from manual selections, no extraction)
  const currentPageResults = useMemo(() => {
    if (!selectedPdf) return { s1: [], s2: [], s3: [] };
    const manualSel = selectedPdf.manualSelections?.[selectedPage] || {};
    const manualProject = selectedPdf.manualProject || null;
    return buildPageResults(manualProject, manualSel);
  }, [selectedPdf, selectedPage]);

  // Clear active field when page or PDF changes
  useEffect(() => {
    setActiveField(null);
  }, [selectedPage, selectedPdfId]);

  // Load all Notion projects on mount
  useEffect(() => {
    fetch('/api/notion-all-projects')
      .then(r => r.json())
      .then(data => {
        setNotionProjects(data.projects || []);
        if (data.error) setNotionProjectsError(data.error);
      })
      .catch(err => {
        // Don't wipe notionProjects if already loaded; if null (first load) set to [] so spinner stops
        setNotionProjects(prev => prev ?? []);
        setNotionProjectsError(err.message);
      });
  }, []);

  // ── Auto-load queued PDFs from Dropbox (pushed by Make Scenario 1) ──────────
  useEffect(() => {
    let cancelled = false;

    async function autoMatchNotion(pdfId, filename, filePath, projects) {
      // Parse filename: {itemNo}_{drawingNo}_{revision}_{initials}.pdf
      const base  = filename.replace(/\.pdf$/i, '');
      const parts = base.split('_');
      if (parts.length < 3) return;
      const itemNo    = parts[0];
      const drawingNo = parts[1];

      // Parse project number + stage from filePath: .../Drawing Submissions/24-367/A4.5/Pending/...
      let projectNo = null, stage = null;
      if (filePath) {
        const fp   = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
        const pidx = fp.findIndex(p => p.toLowerCase() === 'pending');
        if (pidx >= 2) { projectNo = fp[pidx - 2]; stage = fp[pidx - 1]; }
      }

      const project = (projects || []).find(p =>
        (p.projectNumber && p.projectNumber.includes(projectNo)) ||
        (p.projectName   && p.projectName.startsWith(projectNo))
      );
      if (!project) { console.warn(`[auto-match] No project for "${projectNo}"`); return; }

      if (!cancelled) setPdfs(prev => prev.map(p => p.id !== pdfId ? p : { ...p, manualProject: project }));

      try {
        const suffRes = await fetch('/api/notion-suffixes-for-project', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectName: project.projectName }),
        });
        const { suffixes = [] } = await suffRes.json();

        const itemNoPadded = itemNo.padStart(3, '0');
        const suffix = suffixes.find(s =>
          s.suffixNumber === itemNoPadded || s.suffixNumber === itemNo ||
          s.suffixNumber?.replace(/^0+/, '') === itemNo.replace(/^0+/, '')
        );
        if (!suffix) { console.warn(`[auto-match] No suffix for item "${itemNo}"`); return; }

        if (!cancelled) setPdfs(prev => prev.map(p => {
          if (p.id !== pdfId) return p;
          const sel = [...(p.manualSelections || [])];
          sel[0] = { ...(sel[0] || {}), suffixNumber: suffix.suffixNumber, itemPageId: suffix.itemPageId, drawingNumber: null, notionRow: null, issuedFor: stage || null };
          return { ...p, manualSelections: sel };
        }));

        const drawRes = await fetch('/api/notion-drawings-for-project', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemPageId: suffix.itemPageId }),
        });
        const { rows = [] } = await drawRes.json();
        if (!cancelled) setPdfs(prev => prev.map(p => p.id !== pdfId ? p : { ...p, availableProjectDrawings: rows }));

        const drawing = rows.find(r => r.drawingNumber?.toLowerCase() === drawingNo?.toLowerCase());
        if (!drawing) { console.warn(`[auto-match] No drawing for "${drawingNo}"`); return; }

        if (!cancelled) setPdfs(prev => prev.map(p => {
          if (p.id !== pdfId) return p;
          const sel = [...(p.manualSelections || [])];
          sel[0] = { ...(sel[0] || {}), drawingNumber: drawing.drawingNumber, notionRow: drawing };
          return { ...p, manualSelections: sel };
        }));

        if (suffix.suffixNumber && !cancelled) {
          fetch('/api/finishes-lookup', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ suffixNumber: suffix.suffixNumber, projectPageId: project.pageId }),
          }).then(r => r.json()).then(({ rows: fr }) => {
            if (!cancelled) setPdfs(prev => prev.map(p => p.id !== pdfId ? p : { ...p, finishesRows: fr || [] }));
          }).catch(() => {});
        }
      } catch (err) {
        console.warn('[auto-match] Error:', err.message);
      }
    }

    async function loadQueued() {
      try {
        const res = await fetch('/api/queued-pdfs');
        if (!res.ok || cancelled) return;
        const { items = [] } = await res.json();
        if (!items.length) return;

        let projects = [];
        try {
          const pr = await fetch('/api/notion-all-projects');
          projects = (await pr.json()).projects || [];
          if (!cancelled) setNotionProjects(prev => prev ?? projects);
        } catch { /* use empty */ }

        for (const item of items) {
          if (cancelled) return;
          const { downloadUrl, filename, filePath, submissionId } = item;
          try {
            const pdfRes    = await fetch(downloadUrl);
            if (!pdfRes.ok) throw new Error(`Download failed: ${pdfRes.status}`);
            const blob      = new Blob([await pdfRes.arrayBuffer()], { type: 'application/pdf' });
            const objectUrl = URL.createObjectURL(blob);
            const loadedPdf = await pdfjsLib.getDocument(objectUrl).promise;
            const entryId   = makeId();

            const entry = {
              id: entryId, displayName: filename, serverFilename: filename,
              pdfDoc: loadedPdf, totalPages: loadedPdf.numPages,
              checked: true, expanded: true, status: 'uploaded',
              submissionId: submissionId || null,
              filePath:     filePath     || null,
              finishesRows: null, finishesError: null,
              manualProject: null, availableProjectDrawings: null,
              projectDrawingsLoading: false, notionRefreshing: false,
              manualSelections: [], revisionTableDates: {}, customFields: {},
            };

            if (!cancelled) {
              setPdfs(prev => [...prev, entry]);
              setSelectedPdfId(prev => prev || entryId);
              setSelectedPage(0);
              autoMatchNotion(entryId, filename, filePath, projects);
            }
          } catch (err) {
            console.warn(`[queued-pdfs] Failed to load "${filename}":`, err.message);
          }
        }
      } catch (err) {
        console.warn('[queued-pdfs] Poll failed:', err.message);
      }
    }

    loadQueued();
    return () => { cancelled = true; };
  }, []); // mount only

  // Compute numbered pins for the current page view
  const pinsForPage = useMemo(() => {
    if (!selectedPdfId || !selectedPdf) return [];
    const pagePins = pins[selectedPdfId]?.[selectedPage] || {};
    let n = 0;

    // Standard fields in static order
    const validationPins = STATIC_FIELD_ORDER.map(field => {
      if (checkOptions[field] === false) return null;
      const override = getStatusOverride(selectedPdfId, selectedPage, field);
      if (override !== 'fail') return null;
      n++;
      const pin = pagePins[field];
      if (!pin) return null;
      return { field, number: n, x: pin.x, y: pin.y };
    }).filter(Boolean);

    // Custom fields
    const pageCustomFields = selectedPdf.customFields?.[selectedPage] || [];
    const customPins = pageCustomFields.map(cf => {
      const override = getStatusOverride(selectedPdfId, selectedPage, cf.id);
      if (override !== 'fail') return null;
      n++;
      const pin = pagePins[cf.id];
      if (!pin) return null;
      return { field: cf.id, number: n, x: pin.x, y: pin.y };
    }).filter(Boolean);

    // Finishes FAIL pins (stored on page 0, shown on all pages)
    const finishesRows = selectedPdf.finishesRows || [];
    const finishesPage0Pins = pins[selectedPdfId]?.[0] || {};
    const finishesPins = finishesRows.flatMap((row, i) => {
      const field = `finishes-row-${i}`;
      const override = getFinishesOverride(selectedPdfId, i);
      if (override !== 'fail') return [];
      const pin = finishesPage0Pins[field];
      if (!pin) return [];
      n++;
      return [{ field, number: n, x: pin.x, y: pin.y, label: `Finishes: ${row.cadRef || row.specRef || `Row ${i + 1}`}` }];
    });

    return [...validationPins, ...customPins, ...finishesPins];
  }, [selectedPdfId, selectedPdf, selectedPage, pins, checkOptions, getStatusOverride, statusOverrides, getFinishesOverride, finishesOverrides]);

  // Fail number map for badge display in validation rows
  const failNumbers = useMemo(() => {
    if (!selectedPdfId || !selectedPdf) return {};
    const map = {};
    let n = 0;

    STATIC_FIELD_ORDER.forEach(field => {
      if (checkOptions[field] === false) return;
      const override = getStatusOverride(selectedPdfId, selectedPage, field);
      if (override === 'fail') map[field] = ++n;
    });

    const pageCustomFields = selectedPdf.customFields?.[selectedPage] || [];
    pageCustomFields.forEach(cf => {
      const override = getStatusOverride(selectedPdfId, selectedPage, cf.id);
      if (override === 'fail') map[cf.id] = ++n;
    });

    (selectedPdf.finishesRows || []).forEach((_, i) => {
      if (getFinishesOverride(selectedPdfId, i) === 'fail') {
        map[`finishes-row-${i}`] = ++n;
      }
    });
    return map;
  }, [selectedPdfId, selectedPage, selectedPdf, checkOptions, getStatusOverride, statusOverrides, getFinishesOverride, finishesOverrides]);

  // ── Upload multiple PDFs (no extraction — just upload + PDF.js load) ──

  const uploadMultiple = async (files) => {
    const fileArray = Array.from(files).filter((f) => f.type === 'application/pdf');
    if (fileArray.length === 0) {
      alert('Please select PDF files.');
      return;
    }

    setUploading(true);
    setProcessingError(null);

    const newEntries = [];
    for (const file of fileArray) {
      const entryId = makeId();
      try {
        const objectUrl = URL.createObjectURL(file);
        const loadedPdf = await pdfjsLib.getDocument(objectUrl).promise;
        uploadedFilesRef.current.set(entryId, file);

        newEntries.push({
          id: entryId,
          displayName: file.name,
          serverFilename: file.name,
          pdfDoc: loadedPdf,
          totalPages: loadedPdf.numPages,
          checked: true,
          expanded: true,
          status: 'uploaded',
          submissionId: null,
          filePath: null,
          finishesRows: null,
          finishesError: null,
          // Manual selection state
          manualProject: null,
          availableProjectDrawings: null,
          projectDrawingsLoading: false,
          notionRefreshing: false,
          manualSelections: [],
          revisionTableDates: {},
          customFields: {},
        });
      } catch (err) {
        uploadedFilesRef.current.set(entryId, file);
        newEntries.push({
          id: entryId,
          displayName: file.name,
          serverFilename: null,
          pdfDoc: null,
          totalPages: 0,
          checked: false,
          expanded: false,
          status: 'upload-error',
          uploadError: err.message,
          finishesRows: null,
          finishesError: null,
          manualProject: null,
          availableProjectDrawings: null,
          projectDrawingsLoading: false,
          notionRefreshing: false,
          manualSelections: [],
          revisionTableDates: {},
          customFields: {},
        });
      }
    }

    const successEntries = newEntries.filter(e => e.status !== 'upload-error');
    setPdfs((prev) => [...prev, ...newEntries]);

    if (successEntries.length > 0) {
      setSelectedPdfId((prev) => prev || successEntries[0].id);
      setSelectedPage(0);
    } else if (newEntries.length > 0) {
      setSelectedPdfId((prev) => prev || newEntries[0].id);
    }

    setUploading(false);
  };

  // ── Load Pending: called by LoadPendingModal when a submission PDF is loaded ──
  // ── Load all pending submissions from ADF in one click ───────────────────────
  const loadAllPending = useCallback(async () => {
    if (loadingPending) return;
    setLoadingPending(true);

    try {
      // 1. Fetch submission list
      const subRes = await fetch('/api/df-submissions');
      if (!subRes.ok) throw new Error(`df-submissions: ${subRes.status}`);
      const { submissions = [] } = await subRes.json();
      if (!submissions.length) { setLoadingPending(false); return; }

      // 2. Fetch Notion projects once
      let projects = notionProjects;
      if (!projects) {
        try {
          const pr = await fetch('/api/notion-all-projects');
          projects = (await pr.json()).projects || [];
          setNotionProjects(prev => prev ?? projects);
        } catch { projects = []; }
      }

      let firstId = null;

      for (const sub of submissions) {
        if (!sub.dropboxPath) continue;
        try {
          // 3. Fetch PDF from local Dropbox
          const pdfRes = await fetch(`/api/local-pdf?path=${encodeURIComponent(sub.dropboxPath)}`);
          if (!pdfRes.ok) { console.warn(`[load-pending] ${sub.title}: ${pdfRes.status}`); continue; }

          const blob      = new Blob([await pdfRes.arrayBuffer()], { type: 'application/pdf' });
          const objectUrl = URL.createObjectURL(blob);
          const loadedPdf = await pdfjsLib.getDocument(objectUrl).promise;
          const filename  = sub.dropboxPath.split('/').pop();
          const entryId   = makeId();
          if (!firstId) firstId = entryId;

          const entry = {
            id: entryId, displayName: filename, serverFilename: filename,
            pdfDoc: loadedPdf, totalPages: loadedPdf.numPages,
            checked: true, expanded: true, status: 'uploaded',
            submissionId: sub.id, filePath: null,
            finishesRows: null, finishesError: null,
            manualProject: null, availableProjectDrawings: null,
            projectDrawingsLoading: false, notionRefreshing: false,
            manualSelections: [], revisionTableDates: {}, customFields: {},
          };
          setPdfs(prev => [...prev, entry]);
          setSelectedPdfId(prev => prev || entryId);
          setSelectedPage(0);

          // 4. Auto-match Notion data from submission metadata
          const projectNo = sub.taskCode?.split('-').slice(0, 2).join('-');
          const project   = (projects || []).find(p =>
            (p.projectNumber && p.projectNumber.includes(projectNo)) ||
            (p.projectName   && p.projectName.startsWith(projectNo))
          );
          if (!project) continue;
          setPdfs(prev => prev.map(p => p.id !== entryId ? p : { ...p, manualProject: project }));

          const { suffixes = [] } = await fetch('/api/notion-suffixes-for-project', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectName: project.projectName }),
          }).then(r => r.json()).catch(() => ({ suffixes: [] }));

          const itemNo = sub.taskCode?.split('-')[2] || '';
          const suffix = suffixes.find(s => s.suffixNumber === itemNo.padStart(3, '0') || s.suffixNumber === itemNo);
          if (!suffix) continue;

          setPdfs(prev => prev.map(p => {
            if (p.id !== entryId) return p;
            const sel = [...(p.manualSelections || [])];
            sel[0] = { ...(sel[0] || {}), suffixNumber: suffix.suffixNumber, itemPageId: suffix.itemPageId, drawingNumber: null, notionRow: null, issuedFor: sub.stage || null };
            return { ...p, manualSelections: sel };
          }));

          const { rows = [] } = await fetch('/api/notion-drawings-for-project', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemPageId: suffix.itemPageId }),
          }).then(r => r.json()).catch(() => ({ rows: [] }));

          setPdfs(prev => prev.map(p => p.id !== entryId ? p : { ...p, availableProjectDrawings: rows }));

          const drawing = rows.find(r => r.drawingNumber?.toLowerCase() === sub.drawingNo?.toLowerCase());
          if (drawing) {
            setPdfs(prev => prev.map(p => {
              if (p.id !== entryId) return p;
              const sel = [...(p.manualSelections || [])];
              sel[0] = { ...(sel[0] || {}), drawingNumber: drawing.drawingNumber, notionRow: drawing };
              return { ...p, manualSelections: sel };
            }));
          }

          fetch('/api/finishes-lookup', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ suffixNumber: suffix.suffixNumber, projectPageId: project.pageId }),
          }).then(r => r.json()).then(({ rows: fr }) => {
            setPdfs(prev => prev.map(p => p.id !== entryId ? p : { ...p, finishesRows: fr || [] }));
          }).catch(() => {});

        } catch (err) {
          console.warn(`[load-pending] ${sub.title}:`, err.message);
        }
      }
    } catch (err) {
      console.error('[load-pending]', err.message);
    } finally {
      setLoadingPending(false);
    }
  }, [loadingPending, notionProjects]);

  // ── PDF list helpers ──

  const togglePdfChecked = (pdfId) => {
    setPdfs((prev) => prev.map((p) => (p.id === pdfId ? { ...p, checked: !p.checked } : p)));
  };

  const toggleAllChecked = () => {
    setPdfs((prev) => {
      const allChecked = prev.every((p) => p.checked);
      return prev.map((p) => ({ ...p, checked: !allChecked }));
    });
  };

  const togglePdfExpanded = (pdfId) => {
    setPdfs((prev) => prev.map((p) => (p.id === pdfId ? { ...p, expanded: !p.expanded } : p)));
  };

  const selectPage = (pdfId, pageIndex) => {
    setSelectedPdfId(pdfId);
    setSelectedPage(pageIndex);
  };

  const retryUpload = async (pdfId) => {
    const file = uploadedFilesRef.current.get(pdfId);
    if (!file) return;
    uploadedFilesRef.current.delete(pdfId);
    removePdf(pdfId);
    await uploadMultiple([file]);
  };

  const removePdf = (pdfId) => {
    setPdfs((prev) => {
      const next = prev.filter((p) => p.id !== pdfId);
      if (selectedPdfId === pdfId) {
        setSelectedPdfId(next.length > 0 ? next[0].id : null);
        setSelectedPage(0);
      }
      return next;
    });
  };

  const addMoreFiles = () => addFileInputRef.current?.click();

  const handleAddFileSelect = (e) => {
    const files = e.target.files;
    if (files?.length) uploadMultiple(files);
    e.target.value = '';
  };

  // ── Reset ──

  const resetAll = () => {
    setPdfs([]);
    setSelectedPdfId(null);
    setSelectedPage(0);
    setProcessingError(null);
    setCollapsed({ 'export-markups': true });
    setPdfScale(null);
    setActiveField(null);
    setPins({});
    setRightPanelTab('page');
    setDragListItemId(null);
    setDragOverItemId(null);
    setStatusOverrides({});
    setFinishesOverrides({});
  };

  // ── Check option handlers ──

  const toggleCheckOption = useCallback((field) => {
    setCheckOptions(prev => {
      const next = { ...prev, [field]: prev[field] === false ? true : false };
      saveCheckOptions(next);
      return next;
    });
  }, []);

  const handleResetChecks = useCallback(() => {
    const reset = { ...DEFAULT_CHECK_OPTIONS };
    setCheckOptions(reset);
    saveCheckOptions(reset);
  }, []);

  const handleExportOptions = useCallback(() => {
    const blob = new Blob([JSON.stringify(checkOptions, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'check-options.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [checkOptions]);

  const handleImportOptions = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const imported = JSON.parse(text);
        const merged = { ...DEFAULT_CHECK_OPTIONS, ...imported };
        setCheckOptions(merged);
        saveCheckOptions(merged);
      } catch {
        alert('Invalid check options file');
      }
    };
    input.click();
  }, []);

  // ── PDF list drag-to-reorder handlers ──

  const handlePdfDragStart = useCallback((e, pdfId) => {
    setDragListItemId(pdfId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', pdfId);
  }, []);

  const handlePdfDragOver = useCallback((e, pdfId) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverItemId(pdfId);
  }, []);

  const handlePdfDrop = useCallback((e, targetPdfId) => {
    e.preventDefault();
    e.stopPropagation();
    const sourcePdfId = dragListItemId;
    setDragListItemId(null);
    setDragOverItemId(null);
    if (!sourcePdfId || sourcePdfId === targetPdfId) return;
    setPdfs((prev) => {
      const fromIdx = prev.findIndex((p) => p.id === sourcePdfId);
      const toIdx = prev.findIndex((p) => p.id === targetPdfId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [...prev];
      const [removed] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, removed);
      return next;
    });
  }, [dragListItemId]);

  const handlePdfDragEnd = useCallback(() => {
    setDragListItemId(null);
    setDragOverItemId(null);
  }, []);

  // ── File drag & drop ──

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files?.length) uploadMultiple(files);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  const handleFileSelect = (e) => {
    const files = e.target.files;
    if (files?.length) uploadMultiple(files);
    e.target.value = '';
  };

  // ── Pin interaction ──

  const handlePinClick = useCallback((field) => {
    setActiveField(prev => prev === field ? null : field);
    setTimeout(() => {
      const row = detailsScrollRef.current?.querySelector(`[data-field="${field}"]`);
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  }, []);

  const handleRowClick = useCallback((field) => {
    setActiveField(prev => prev === field ? null : field);
  }, []);

  const handlePinDragEnd = useCallback((field, x, y) => {
    setPins(prev => ({
      ...prev,
      [selectedPdfId]: {
        ...(prev[selectedPdfId] || {}),
        [selectedPage]: {
          ...(prev[selectedPdfId]?.[selectedPage] || {}),
          [field]: { x, y },
        },
      },
    }));
  }, [selectedPdfId, selectedPage]);

  const handlePinDelete = useCallback((field) => {
    setPins(prev => {
      const pagePins = { ...(prev[selectedPdfId]?.[selectedPage] || {}) };
      delete pagePins[field];
      return {
        ...prev,
        [selectedPdfId]: {
          ...(prev[selectedPdfId] || {}),
          [selectedPage]: pagePins,
        },
      };
    });
  }, [selectedPdfId, selectedPage]);

  const checkedCount = pdfs.filter((p) => p.checked).length;

  // ═══════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════

  return (
    <div className="app">
      <header className="header">
        <h1 className="header-title">DT Drawing Checker</h1>
        <span className="header-subtitle">Technical Drawing Review Tool</span>
      </header>

      <main className="main results-main">

        {/* ════ Left Panel — PDF List ════ */}
        <section
          className="panel panel-pagelist"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {/* Panel header — always visible */}
          <div className="pagelist-header">
            <span className="pagelist-title">Drawings</span>
            <div className="pagelist-header-actions">
              <button className="btn btn-small btn-pending" onClick={loadAllPending} disabled={loadingPending} title="Load all pending submissions from Axiom Drawing Flow">
                {loadingPending ? '…' : 'Pending'}
              </button>
              <button className="btn btn-small" onClick={addMoreFiles} style={{ display: pdfs.length ? '' : 'none' }}>Add</button>
              <button className="btn btn-small" onClick={resetAll} style={{ display: pdfs.length ? '' : 'none' }}>Clear All</button>
            </div>
            <input
              ref={addFileInputRef}
              type="file"
              accept="application/pdf"
              multiple
              onChange={handleAddFileSelect}
              hidden
            />
          </div>

          {pdfs.length === 0 ? (
            <div className="pagelist-empty">
              <p className="pagelist-empty-title">No drawings loaded</p>
              <p className="pagelist-empty-hint">Upload PDFs to get started</p>
            </div>
          ) : (
            <>


              <div className="pagelist-select-all">
                <label className="select-all-label">
                  <input
                    type="checkbox"
                    checked={pdfs.length > 0 && pdfs.every((p) => p.checked)}
                    onChange={toggleAllChecked}
                  />
                  <span>{pdfs.every((p) => p.checked) ? 'Deselect All' : 'Select All'}</span>
                </label>
                <span className="pdf-count">
                  {pdfs.length} PDF{pdfs.length !== 1 ? 's' : ''}
                </span>
              </div>

              <div className="pdf-list">
                {pdfs.map((pdf) => {
                  const isPdfSelected = pdf.id === selectedPdfId;
                  const pdfBadge = getPdfStatus(pdf);
                  const isDragging = dragListItemId === pdf.id;
                  const isDragTarget = dragOverItemId === pdf.id && dragListItemId !== pdf.id;

                  return (
                    <div
                      key={pdf.id}
                      className={`pdf-entry ${isPdfSelected ? 'pdf-entry-selected' : ''} ${isDragging ? 'pdf-entry-dragging' : ''} ${isDragTarget ? 'pdf-entry-drag-target' : ''}`}
                      draggable
                      onDragStart={(e) => handlePdfDragStart(e, pdf.id)}
                      onDragOver={(e) => handlePdfDragOver(e, pdf.id)}
                      onDrop={(e) => handlePdfDrop(e, pdf.id)}
                      onDragEnd={handlePdfDragEnd}
                    >
                      <div className="pdf-entry-header">
                        <span className="pdf-drag-handle" title="Drag to reorder">⠿</span>
                        <input
                          type="checkbox"
                          checked={pdf.checked}
                          onChange={(e) => { e.stopPropagation(); togglePdfChecked(pdf.id); }}
                          className="pdf-checkbox"
                        />
                        <button className="pdf-expand-btn" onClick={() => togglePdfExpanded(pdf.id)}>
                          <span className={`v-chevron ${!pdf.expanded ? 'v-chevron-closed' : ''}`}>&#9662;</span>
                        </button>
                        <div className="pdf-entry-info" onClick={() => pdf.status !== 'upload-error' && selectPage(pdf.id, 0)}>
                          <span className="pdf-entry-name" title={pdf.displayName}>{pdf.displayName}</span>
                          {pdf.status !== 'upload-error' && (
                            <span className="pdf-entry-pages">
                              {`${pdf.totalPages} pg${pdf.totalPages !== 1 ? 's' : ''}`}
                            </span>
                          )}
                        </div>
                        <div className="pdf-entry-actions">
                          {pdfBadge && (
                            <span className={`badge badge-${pdfBadge} badge-tiny`}>
                              {pdfBadge === 'pass' ? 'Pass' : pdfBadge === 'warning' ? 'Warn' : 'Fail'}
                            </span>
                          )}
                          {pdf.status === 'upload-error' && (
                            <span className="badge badge-fail badge-tiny">Failed</span>
                          )}
                          <button
                            className="btn-icon-small btn-remove"
                            onClick={(e) => { e.stopPropagation(); removePdf(pdf.id); }}
                            title="Remove PDF"
                          >
                            &times;
                          </button>
                        </div>
                      </div>

                      {pdf.status === 'upload-error' && (
                        <div className="pdf-upload-error">
                          <p className="pdf-upload-error-msg">{pdf.uploadError}</p>
                          <button className="btn btn-small" onClick={() => retryUpload(pdf.id)}>Retry Upload</button>
                        </div>
                      )}

                      {pdf.expanded && pdf.status !== 'upload-error' && (
                        <div className="pdf-page-sublist">
                          {Array.from({ length: pdf.totalPages }, (_, i) => {
                            const isPageSelected = isPdfSelected && i === selectedPage;
                            const drawingNum = pdf.manualSelections?.[i]?.drawingNumber || null;

                            // Page badge from overrides
                            let pageBadge = null;
                            const pagePrefix = `${pdf.id}-${i}-`;
                            for (const [key, val] of Object.entries(statusOverrides)) {
                              if (!key.startsWith(pagePrefix)) continue;
                              if (val === 'fail') { pageBadge = 'fail'; break; }
                              if (val === 'warning') pageBadge = 'warning';
                            }
                            // Finishes on page 0
                            if (!pageBadge && i === 0) {
                              for (let fi = 0; fi < (pdf.finishesRows?.length || 0); fi++) {
                                const s = getFinishesOverride(pdf.id, fi);
                                if (s === 'fail') { pageBadge = 'fail'; break; }
                                if (s === 'warning') pageBadge = 'warning';
                              }
                            }

                            return (
                              <button
                                key={i}
                                className={`page-subitem ${isPageSelected ? 'page-subitem-selected' : ''}`}
                                onClick={() => selectPage(pdf.id, i)}
                              >
                                <span className="page-subitem-num">P{i + 1}</span>
                                {drawingNum && (
                                  <span className="page-subitem-drawing" title={drawingNum}>{drawingNum}</span>
                                )}
                                {pageBadge && (
                                  <span className={`badge badge-${pageBadge} badge-tiny`}>
                                    {pageBadge === 'pass' ? 'Pass' : pageBadge === 'warning' ? 'Warn' : 'Fail'}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}

                {dragOver && <div className="pdf-list-drop-hint">Drop PDFs here to add</div>}
              </div>
            </>
          )}
        </section>

        {/* ════ Centre Panel — PDF Viewer / Upload Zone ════ */}
        <section className="panel panel-viewer">
          {overallStatus && (
            <div className="viewer-status-bar">
              <span className={`overall-badge overall-${overallStatus.status}`}>
                {overallStatus.status === 'pass' ? 'ALL PASS' : overallStatus.status === 'warning' ? 'WARNINGS' : 'FAILURES'}
              </span>
              <div className="overall-counts">
                <span className="oc-pass">{overallStatus.pass} passed</span>
                <span className="oc-warning">{overallStatus.warning} warnings</span>
                <span className="oc-fail">{overallStatus.fail} failed</span>
              </div>
            </div>
          )}

          {pinsForPage.length > 0 && (
            <div className="placement-prompt">
              <span>{pinsForPage.length} failure marker{pinsForPage.length !== 1 ? 's' : ''} auto-placed in the title block area.</span>
              <span className="placement-hint">Drag pins to exact positions. Right-click to remove.</span>
              <button
                className="placement-reset-btn"
                onClick={() => setPins(prev => ({
                  ...prev,
                  [selectedPdfId]: { ...(prev[selectedPdfId] || {}), [selectedPage]: {} },
                }))}
              >
                Reset Pins
              </button>
            </div>
          )}

          <div className="viewer-body">
            {activePdfDoc ? (
              <PdfViewer
                pdfDoc={activePdfDoc}
                pageNumber={selectedPage + 1}
                scale={pdfScale}
                pins={pinsForPage}
                activeField={activeField}
                onPinClick={handlePinClick}
                onPinDragEnd={handlePinDragEnd}
                onPinDelete={handlePinDelete}
              />
            ) : (
              <div
                className={`center-upload-zone ${dragOver ? 'drag-over' : ''}`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  multiple
                  onChange={handleFileSelect}
                  hidden
                />
                {uploading ? (
                  <div className="center-upload-loading">
                    <div className="spinner" />
                    <p className="loading-text">Uploading...</p>
                    <p className="loading-hint">Sending files to server</p>
                  </div>
                ) : (
                  <>
                    <div className="upload-icon">
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="12" y1="18" x2="12" y2="12" />
                        <line x1="9" y1="15" x2="12" y2="12" />
                        <line x1="15" y1="15" x2="12" y2="12" />
                      </svg>
                    </div>
                    <p className="upload-text">Drag PDF files here or click to browse</p>
                    <p className="upload-hint">Supports multiple multi-page PDF files up to 50MB each</p>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="viewer-nav">
            <button className="btn btn-small" disabled={selectedPage <= 0} onClick={() => setSelectedPage((p) => p - 1)}>&lt; Prev</button>
            <span className="page-nav-label">
              {activeTotalPages > 0 ? `Page ${selectedPage + 1} of ${activeTotalPages}` : 'No PDF selected'}
            </span>
            <button className="btn btn-small" disabled={selectedPage >= activeTotalPages - 1} onClick={() => setSelectedPage((p) => p + 1)}>Next &gt;</button>
            <button
              className="btn btn-small viewer-zoom-btn"
              onClick={() => setPdfScale((s) => (s == null ? 1.0 : null))}
              title={pdfScale == null ? 'Zoom 100%' : 'Fit Width'}
            >
              {pdfScale == null ? '100%' : 'Fit'}
            </button>
          </div>
        </section>

        {/* ════ Right Panel — Details ════ */}
        <section className="panel panel-details">
          {!selectedPdf ? (
            <div className="results-placeholder">
              <p className="placeholder-text">{pdfs.length === 0 ? 'Upload PDFs to get started' : 'Select a page to view details'}</p>
            </div>
          ) : (
            <>
              {/* Tab bar */}
              <div className="details-tab-bar">
                <button
                  className={`details-tab ${rightPanelTab === 'page' ? 'details-tab-active' : ''}`}
                  onClick={() => setRightPanelTab('page')}
                >
                  Current Page
                </button>
                <button
                  className={`details-tab ${rightPanelTab === 'summary' ? 'details-tab-active' : ''}`}
                  onClick={() => setRightPanelTab('summary')}
                >
                  Summary
                </button>
                <button className="btn-header-action" onClick={handleResetChecks} title="Re-enable all checks">Reset</button>
                <button className="btn-header-action" onClick={handleExportOptions} title="Export check options">Opts ↓</button>
                <button className="btn-header-action" onClick={handleImportOptions} title="Import check options">Opts ↑</button>
              </div>

              {rightPanelTab === 'page' ? (
                <div className="details-scroll" ref={detailsScrollRef}>

                  {/* ── Cascade dropdown selectors ── */}
                  <ManualSelectionPanel
                    pdf={selectedPdf}
                    pageIndex={selectedPage}
                    notionProjects={notionProjects}
                    notionProjectsError={notionProjectsError}
                    onSelectProject={(project) => setManualProject(selectedPdfId, project)}
                    onSelectSuffix={(suffixNumber, itemPageId) => {
                      setManualSuffix(selectedPdfId, selectedPage, suffixNumber, itemPageId);
                      if (selectedPage === 0) triggerFinishesLookup(selectedPdfId, suffixNumber, selectedPdf?.manualProject?.pageId);
                    }}
                    onSelectDrawing={(drawingNumber, notionRow) => setManualPageSelection(selectedPdfId, selectedPage, { drawingNumber, notionRow })}
                    onSelectIssuedFor={(issuedFor) => setManualPageSelection(selectedPdfId, selectedPage, { issuedFor })}
                    onRefresh={() => refreshNotionData(selectedPdfId)}
                    isRefreshing={selectedPdf?.notionRefreshing || false}
                  />

                  {/* ── Project Details ── */}
                  <ValidationSection
                    title="Project Details"
                    results={currentPageResults.s1}
                    sectionKey={`s1-${selectedPdfId}-${selectedPage}`}
                    collapsed={collapsed}
                    toggleCollapse={toggleCollapse}
                    columns={['Field', 'Expected', 'Result']}
                    activeField={activeField}
                    onRowClick={handleRowClick}
                    checkOptions={checkOptions}
                    onToggleCheck={toggleCheckOption}
                    pdfId={selectedPdfId}
                    pageIndex={selectedPage}
                    onOverride={setStatusOverride}
                    clearOverride={clearStatusOverride}
                    getOverride={getStatusOverride}
                    failNumbers={failNumbers}
                  />

                  {/* ── Drawing Data ── */}
                  <ValidationSection
                    title="Drawing Data Checks"
                    results={currentPageResults.s2}
                    sectionKey={`s2-${selectedPdfId}-${selectedPage}`}
                    collapsed={collapsed}
                    toggleCollapse={toggleCollapse}
                    columns={['Field', 'Expected', 'Result']}
                    activeField={activeField}
                    onRowClick={handleRowClick}
                    checkOptions={checkOptions}
                    onToggleCheck={toggleCheckOption}
                    pdfId={selectedPdfId}
                    pageIndex={selectedPage}
                    onOverride={setStatusOverride}
                    clearOverride={clearStatusOverride}
                    getOverride={getStatusOverride}
                    failNumbers={failNumbers}
                  />

                  {/* ── Drawing Status ── */}
                  <ValidationSection
                    title="Drawing Status"
                    results={currentPageResults.s3}
                    sectionKey={`s3-${selectedPdfId}-${selectedPage}`}
                    collapsed={collapsed}
                    toggleCollapse={toggleCollapse}
                    columns={['Field', 'Expected', 'Result']}
                    activeField={activeField}
                    onRowClick={handleRowClick}
                    checkOptions={checkOptions}
                    onToggleCheck={toggleCheckOption}
                    pdfId={selectedPdfId}
                    pageIndex={selectedPage}
                    onOverride={setStatusOverride}
                    clearOverride={clearStatusOverride}
                    getOverride={getStatusOverride}
                    failNumbers={failNumbers}
                  />

                  {/* ── Revision Table ── */}
                  {(() => {
                    const manualSel = selectedPdf?.manualSelections?.[selectedPage];
                    const issuedFor = manualSel?.issuedFor;
                    const issuedForLabel = ISSUED_FOR_OPTIONS.find(o => o.value === issuedFor)?.label || '';
                    const revision = manualSel?.notionRow?.revision || '';
                    // Date expected: S5 drawings → S4 DT Delivery Date; A4.5/Construction → S5 DT Delivery Date
                    const expectedDate = issuedFor === 'S5'
                      ? (manualSel?.notionRow?.s4DtDeliveryDateActual || '')
                      : (issuedFor === 'A4.5' || issuedFor === 'CONSTRUCTION')
                        ? (manualSel?.notionRow?.s5DtDeliveryDateActual || '')
                        : '';
                    return (
                      <RevisionTablePanel
                        revision={revision}
                        description={issuedForLabel}
                        expectedDate={expectedDate}
                        pdfId={selectedPdfId}
                        pageIndex={selectedPage}
                        onOverride={setStatusOverride}
                        clearOverride={clearStatusOverride}
                        getOverride={getStatusOverride}
                        failNumbers={failNumbers}
                        sectionKey={`revtable-${selectedPdfId}-${selectedPage}`}
                        collapsed={collapsed}
                        toggleCollapse={toggleCollapse}
                      />
                    );
                  })()}

                  {/* ── Finishes ── */}
                  <FinishesSection
                    rows={selectedPdf?.finishesRows ?? null}
                    error={selectedPdf?.finishesError ?? null}
                    sectionKey={`finishes-${selectedPdfId}`}
                    collapsed={collapsed}
                    toggleCollapse={toggleCollapse}
                    pdfId={selectedPdfId}
                    getOverride={getFinishesOverride}
                    setOverride={setFinishesOverride}
                    clearOverride={clearFinishesOverride}
                    failNumbers={failNumbers}
                    onRefresh={refreshFinishes}
                  />

                  {/* ── Custom Checks ── */}
                  <CustomFieldsPanel
                    pdfId={selectedPdfId}
                    pageIndex={selectedPage}
                    customFields={selectedPdf?.customFields?.[selectedPage] || []}
                    addField={addCustomField}
                    removeField={removeCustomField}
                    updateField={updateCustomField}
                    getOverride={getStatusOverride}
                    onOverride={setStatusOverride}
                    clearOverride={clearStatusOverride}
                    failNumbers={failNumbers}
                    activeField={activeField}
                    onRowClick={handleRowClick}
                    sectionKey={`custom-${selectedPdfId}-${selectedPage}`}
                    collapsed={collapsed}
                    toggleCollapse={toggleCollapse}
                  />

                  {/* ── Export ── */}
                  <ExportSection
                    pdfs={pdfs}
                    filterByOptions={filterByOptions}
                    getOverride={getStatusOverride}
                    collapsed={collapsed}
                    toggleCollapse={toggleCollapse}
                    pins={pins}
                    finishesOverrides={finishesOverrides}
                  />
                </div>
              ) : (
                /* Summary tab */
                <div className="details-scroll">
                  <SummaryView
                    pdfs={pdfs}
                    statusOverrides={statusOverrides}
                    finishesOverrides={finishesOverrides}
                    getFinishesOverride={getFinishesOverride}
                    getPdfStatus={getPdfStatus}
                  />
                </div>
              )}
            </>
          )}
        </section>
      </main>

    </div>
  );
}

// ── Collapsible validation section component ──

function ValidationSection({
  title,
  results,
  sectionKey,
  collapsed,
  toggleCollapse,
  columns,
  activeField,
  onRowClick,
  checkOptions = {},
  onToggleCheck,
  pdfId,
  pageIndex,
  onOverride,
  clearOverride,
  getOverride,
  failNumbers = {},
}) {
  const effectiveResults = results.map(r => {
    const override = getOverride?.(pdfId, pageIndex, r.field);
    return override ? { ...r, status: override } : r;
  });
  const enabledResults = effectiveResults.filter(r => checkOptions[r.field] !== false);
  const summary = getSectionSummary(enabledResults);
  const isCollapsed = collapsed[sectionKey];

  return (
    <div className="v-section">
      <button className="v-section-header" onClick={() => toggleCollapse(sectionKey)}>
        <div className="v-section-left">
          <span className={`v-chevron ${isCollapsed ? 'v-chevron-closed' : ''}`}>&#9662;</span>
          <h3 className="v-section-title">{title}</h3>
        </div>
        <div className="v-section-counts">
          {summary.pass > 0 && <span className="sc-pass">{summary.pass} passed</span>}
          {summary.warning > 0 && <span className="sc-warning">{summary.warning} warnings</span>}
          {summary.fail > 0 && <span className="sc-fail">{summary.fail} failed</span>}
        </div>
      </button>

      {!isCollapsed && (
        <table className="v-table">
          <thead>
            <tr>
              <th className="v-badge-col"></th>
              {columns.map((col) => <th key={col}>{col}</th>)}
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const overrideStatus = getOverride?.(pdfId, pageIndex, r.field);
              const effectiveStatus = overrideStatus || r.status;
              const isIssue = effectiveStatus === 'fail' || effectiveStatus === 'warning';
              const isActive = isIssue && activeField === r.field;
              const badgeNum = failNumbers[r.field];
              const isOverridden = !!overrideStatus;

              const handleClick = (targetStatus, e) => {
                e.stopPropagation();
                if (targetStatus === overrideStatus) {
                  clearOverride?.(pdfId, pageIndex, r.field);
                } else if (targetStatus === r.status && !overrideStatus) {
                  return;
                } else {
                  onOverride?.(pdfId, pageIndex, r.field, targetStatus);
                }
              };

              return (
                <tr
                  key={r.field}
                  className={`vrow vrow-${effectiveStatus} ${isActive ? 'vrow-active' : ''}`}
                  data-field={r.field}
                  onClick={isIssue ? () => onRowClick?.(r.field) : undefined}
                  style={isIssue ? { cursor: 'pointer' } : undefined}
                >
                  <td className="v-badge-cell">
                    {badgeNum ? <span className="fail-badge">{badgeNum}</span> : null}
                  </td>
                  <td className="v-field">{r.label}</td>
                  <td className="v-value">{r.expected || <span className="v-null">—</span>}</td>
                  <td className="v-status">
                    <span className="status-trio">
                      {['pass', 'warning', 'fail'].map(s => {
                        const isActiveBtn = effectiveStatus === s;
                        return (
                          <button
                            key={s}
                            className={`status-btn status-btn-${s}${isActiveBtn ? ' status-btn-active' : ''}${isActiveBtn && isOverridden ? ' status-btn-overridden' : ''}`}
                            onClick={(e) => handleClick(s, e)}
                            title={isActiveBtn && isOverridden ? 'Override active — click to revert' : `Set to ${s.toUpperCase()}`}
                          >
                            {s === 'pass' ? 'PASS' : s === 'warning' ? 'WARN' : 'FAIL'}
                          </button>
                        );
                      })}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Finishes section ──

function FinishesSection({
  rows,
  error,
  sectionKey,
  collapsed,
  toggleCollapse,
  pdfId,
  getOverride,
  setOverride,
  clearOverride,
  failNumbers,
  onRefresh,
}) {
  function defaultFinishStatus() { return 'pass'; }

  const loading = rows === null;
  const effectiveRows = (rows || []).map((row, i) => ({
    ...row,
    status: getOverride?.(pdfId, i) || defaultFinishStatus(),
  }));

  const summary = { pass: 0, warning: 0, fail: 0 };
  effectiveRows.forEach(r => { if (r.status in summary) summary[r.status]++; });

  const isCollapsed = collapsed[sectionKey];

  return (
    <div className="v-section">
      <div className="v-section-header-row">
        <button className="v-section-header" onClick={() => toggleCollapse(sectionKey)} style={{ flex: 1 }}>
          <div className="v-section-left">
            <span className={`v-chevron ${isCollapsed ? 'v-chevron-closed' : ''}`}>&#9662;</span>
            <h3 className="v-section-title">Finishes</h3>
          </div>
          <div className="v-section-counts">
            {loading && <span className="sc-warning">Loading…</span>}
            {!loading && error && <span className="sc-fail">Error</span>}
            {!loading && !error && rows !== null && rows.length === 0 && <span className="sc-warning">No records</span>}
            {!loading && !error && rows !== null && rows.length > 0 && (
              <>
                {summary.pass > 0 && <span className="sc-pass">{summary.pass} passed</span>}
                {summary.warning > 0 && <span className="sc-warning">{summary.warning} warnings</span>}
                {summary.fail > 0 && <span className="sc-fail">{summary.fail} failed</span>}
              </>
            )}
          </div>
        </button>
        {onRefresh && (
          <button className="btn-header-action" onClick={() => onRefresh(pdfId)} title="Re-fetch finishes from Notion" disabled={loading}>
            ↻ Refresh
          </button>
        )}
      </div>

      {!isCollapsed && (
        loading ? (
          <div className="v-section-body-msg"><span className="spinner-tiny" /> Loading finishes data…</div>
        ) : error ? (
          <div className="v-section-body-msg v-section-body-error">{error}</div>
        ) : rows !== null && rows.length === 0 ? (
          <div className="v-section-body-msg">No finishes records found for this suffix</div>
        ) : (
          <table className="v-table v-table-finishes">
            <thead>
              <tr>
                <th className="v-badge-cell"></th>
                <th>Spec Ref</th>
                <th>CAD Ref</th>
                <th>Finish Description</th>
                <th>Sample Ref</th>
                <th>APPROVED</th>
                <th className="v-finishes-result-col">RESULT</th>
              </tr>
            </thead>
            <tbody>
              {effectiveRows.map((row, i) => {
                const overrideStatus = getOverride?.(pdfId, i);
                const naturalStatus = defaultFinishStatus();
                const effectiveStatus = overrideStatus || naturalStatus;
                const isOverridden = !!overrideStatus;
                const field = `finishes-row-${i}`;
                const pinNumber = failNumbers?.[field];

                const handleClick = (targetStatus, e) => {
                  e.stopPropagation();
                  if (targetStatus === overrideStatus) {
                    clearOverride?.(pdfId, i);
                  } else if (targetStatus === naturalStatus && !overrideStatus) {
                    return;
                  } else {
                    setOverride?.(pdfId, i, targetStatus);
                  }
                };

                return (
                  <tr key={row.pageId || i} className={`vrow vrow-${effectiveStatus}`}>
                    <td className="v-badge-cell">
                      {pinNumber != null && <span className="fail-badge" title={`Pin ${pinNumber} on drawing`}>{pinNumber}</span>}
                    </td>
                    <td className="v-value">{row.specRef || <span className="v-null">—</span>}</td>
                    <td className="v-value">{row.cadRef || <span className="v-null">—</span>}</td>
                    <td className="v-value">{row.finishDescription || <span className="v-null">—</span>}</td>
                    <td className="v-value">{row.sampleRef || <span className="v-null">—</span>}</td>
                    <td className="v-value">{row.approved || <span className="v-null">—</span>}</td>
                    <td className="v-status">
                      <span className="status-trio">
                        {['pass', 'warning', 'fail'].map(s => {
                          const isActive = effectiveStatus === s;
                          return (
                            <button
                              key={s}
                              className={`status-btn status-btn-${s}${isActive ? ' status-btn-active' : ''}${isActive && isOverridden ? ' status-btn-overridden' : ''}`}
                              onClick={(e) => handleClick(s, e)}
                              title={isActive && isOverridden ? 'Override active — click to revert' : `Set to ${s.toUpperCase()}`}
                            >
                              {s === 'pass' ? 'PASS' : s === 'warning' ? 'WARN' : 'FAIL'}
                            </button>
                          );
                        })}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}

// ── Summary view across all PDFs ──

function SummaryView({ pdfs, statusOverrides, finishesOverrides, getFinishesOverride, getPdfStatus }) {
  if (pdfs.length === 0) {
    return <div className="results-placeholder"><p className="placeholder-text">No PDFs loaded</p></div>;
  }

  return (
    <div className="summary-view">
      {pdfs.map(pdf => {
        const prefix = `${pdf.id}-`;
        let passes = 0, warns = 0, fails = 0;
        for (const [key, val] of Object.entries(statusOverrides)) {
          if (!key.startsWith(prefix)) continue;
          if (val === 'pass') passes++;
          else if (val === 'warning') warns++;
          else if (val === 'fail') fails++;
        }
        for (let fi = 0; fi < (pdf.finishesRows?.length || 0); fi++) {
          const s = getFinishesOverride(pdf.id, fi);
          if (s === 'pass') passes++;
          else if (s === 'warning') warns++;
          else if (s === 'fail') fails++;
        }
        const pdfStatus = getPdfStatus(pdf);

        return (
          <div key={pdf.id} className="summary-pdf-row">
            {pdfStatus ? (
              <span className={`badge badge-${pdfStatus}`}>
                {pdfStatus === 'pass' ? 'Pass' : pdfStatus === 'warning' ? 'Warn' : 'Fail'}
              </span>
            ) : <span className="badge badge-disabled">—</span>}
            <div className="summary-pdf-info">
              <span className="summary-pdf-name">{pdf.displayName}</span>
              <span className="summary-pdf-pages">{pdf.totalPages} page{pdf.totalPages !== 1 ? 's' : ''}</span>
            </div>
            <div className="summary-pdf-counts">
              {passes > 0 && <span className="oc-pass">{passes}</span>}
              {warns > 0 && <span className="oc-warning">{warns}</span>}
              {fails > 0 && <span className="oc-fail">{fails}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Manual Selection Panel (cascade dropdowns only) ──

function ManualSelectionPanel({
  pdf,
  pageIndex,
  notionProjects,
  notionProjectsError,
  onSelectProject,
  onSelectSuffix,
  onSelectDrawing,
  onSelectIssuedFor,
  onRefresh,
  isRefreshing,
}) {
  const manualProject = pdf?.manualProject || null;
  const manualSel = pdf?.manualSelections?.[pageIndex] || {};
  const allDrawings = pdf?.availableProjectDrawings || [];
  const availableSuffixes = pdf?.availableProjectSuffixes || [];
  const loadingSuffixes = pdf?.projectSuffixesLoading || false;
  const loadingDrawings = pdf?.projectDrawingsLoading || false;

  const availableDrawings = useMemo(() => {
    return allDrawings;
  }, [allDrawings]);

  return (
    <div className="v-section">
      <div className="v-section-header-row">
        <div className="v-section-header precheck-section-header" style={{ flex: 1 }}>
          <div className="v-section-left">
            <h3 className="v-section-title">Select Drawing</h3>
          </div>
          {isRefreshing && <span className="sc-warning" style={{ fontSize: '0.75rem', marginRight: 8 }}>Refreshing…</span>}
        </div>
        <button
          className="btn-header-action"
          onClick={onRefresh}
          disabled={isRefreshing}
          title="Re-fetch project list, drawing data, and finishes from Notion"
        >
          ↻ Refresh
        </button>
      </div>
      <div className="msp-section-body">
        {/* Project */}
        <div className="msp-field-row">
          <label className="msp-label">Project</label>
          <div className="msp-control">
            {notionProjects === null ? (
              <span className="msp-loading">Loading projects…</span>
            ) : (
              <>
                {notionProjectsError && !notionProjects?.length && (
                  <span className="msp-error" style={{ display: 'block', fontSize: '0.7rem', marginBottom: 4 }}>
                    {notionProjectsError} — use ↻ Refresh to retry
                  </span>
                )}
                <select
                  className="msp-select"
                  value={manualProject?.pageId || ''}
                  onChange={e => {
                    const p = (notionProjects || []).find(p => p.pageId === e.target.value) || null;
                    onSelectProject(p);
                  }}
                >
                  <option value="">— Select project —</option>
                  {(notionProjects || []).map(p => (
                    <option key={p.pageId} value={p.pageId}>{p.projectName}</option>
                  ))}
                </select>
              </>
            )}
          </div>
        </div>

        {/* Suffix */}
        <div className="msp-field-row">
          <label className="msp-label">Suffix No.</label>
          <div className="msp-control">
            {loadingSuffixes ? (
              <span className="msp-loading">Loading…</span>
            ) : (
              <select
                className="msp-select"
                value={manualSel.itemPageId || ''}
                disabled={!manualProject}
                onChange={e => {
                  const item = availableSuffixes.find(s => s.itemPageId === e.target.value) || null;
                  onSelectSuffix(item?.suffixNumber || null, item?.itemPageId || null);
                }}
              >
                <option value="">{manualProject ? '— Select suffix —' : '— Select project first —'}</option>
                {availableSuffixes.map(s => (
                  <option key={s.itemPageId || s.suffixNumber} value={s.itemPageId || ''}>
                    {s.suffixNumber || '(unknown)'}
                  </option>
                ))}
              </select>
           