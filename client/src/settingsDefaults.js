/**
 * Check options — toggles for which checks to run.
 *
 * loadCheckOptions()    — reads from localStorage, merges with defaults
 * saveCheckOptions(o)   — writes to localStorage
 * DEFAULT_CHECK_OPTIONS — all toggles ON by default
 */

const STORAGE_KEY = 'dt-drawing-checker-check-options';

export const CHECK_OPTION_FIELDS = [
  // Project Details
  { field: 'projectName',     label: 'Project Name',     section: 'Project Details' },
  { field: 'projectAddress',  label: 'Project Address',  section: 'Project Details' },
  { field: 'projectNumber',   label: 'Project Number',   section: 'Project Details' },
  { field: 'clientName',      label: 'Client Name',      section: 'Project Details' },
  // Drawing Data
  { field: 'suffixNumber',    label: 'Suffix Number',    section: 'Drawing Data' },
  { field: 'drawingTitle1',   label: 'Drawing Title 1',  section: 'Drawing Data' },
  { field: 'drawingTitle2',   label: 'Drawing Title 2',  section: 'Drawing Data' },
  { field: 'drawingTitle3',   label: 'Drawing Title 3',  section: 'Drawing Data' },
  { field: 'drawingNumber',   label: 'Drawing Number',   section: 'Drawing Data' },
  { field: 'revision',        label: 'Revision',         section: 'Drawing Data' },
  // Drawing Status
  { field: 'issuedFor',       label: 'Issued For',       section: 'Drawing Status' },
  { field: 'status',          label: 'Status',           section: 'Drawing Status' },
  { field: 'statusBy',        label: 'Status By',        section: 'Drawing Status' },
  { field: 'statusDate',      label: 'Status Date',      section: 'Drawing Status' },
  { field: 'author',          label: 'Author',           section: 'Drawing Status' },
  // Revision History
  { field: 'revisionHistory', label: 'Revision History', section: 'Revision History' },
];

export const DEFAULT_CHECK_OPTIONS = Object.fromEntries(
  CHECK_OPTION_FIELDS.map((f) => [f.field, true])
);

export function loadCheckOptions() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_CHECK_OPTIONS, ...parsed };
    }
  } catch (e) {
    console.error('Failed to load check options:', e);
  }
  return { ...DEFAULT_CHECK_OPTIONS };
}

export function saveCheckOptions(options) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch (e) {
    console.error('Failed to save check options:', e);
  }
}
