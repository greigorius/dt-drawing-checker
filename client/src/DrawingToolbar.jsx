// DrawingToolbar.jsx — compact floating tool strip for the sketch layer

const COLORS = [
  { value: '#ef4444', label: 'Red'    },
  { value: '#f59e0b', label: 'Amber'  },
  { value: '#22c55e', label: 'Green'  },
  { value: '#3b82f6', label: 'Blue'   },
  { value: '#ffffff', label: 'White'  },
  { value: '#111827', label: 'Black'  },
];

const WIDTHS = [1, 2, 4, 8];

const FONT_SIZES = [
  { label: 'S', value: 0.015 },
  { label: 'M', value: 0.025 },
  { label: 'L', value: 0.040 },
];

// ─── SVG icon helpers ──────────────────────────────────────────────────────
function Icon({ children, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

const icons = {
  pan:       <Icon><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></Icon>,
  select:    <Icon><path d="M5 3l14 9-7 1-4 7L5 3z"/></Icon>,
  pen:       <Icon><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></Icon>,
  highlight: <Icon><path d="M9 11l-6 6v3h3l6-6"/><path d="M22 2l-3 3-6.07 6.07"/><line x1="17" y1="1" x2="22" y2="6"/></Icon>,
  arrow:     <Icon><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></Icon>,
  rect:      <Icon><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></Icon>,
  ellipse:   <Icon><ellipse cx="12" cy="12" rx="10" ry="6"/></Icon>,
  line:      <Icon><line x1="5" y1="19" x2="19" y2="5"/></Icon>,
  text:      <Icon><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></Icon>,
  eraser:    <Icon><path d="M20 20H7L3 16l11-11 6 6-2.5 2.5"/><path d="M6.0001 11L13 18"/></Icon>,
  undo:      <Icon><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></Icon>,
  clear:     <Icon><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></Icon>,
};

const TOOLS = [
  { id: 'pan',       label: 'Pan (scroll/zoom)',            group: 'nav'      },
  { id: 'select',    label: 'Select / Move / Delete (Del)', group: 'nav'      },
  { id: 'pen',       label: 'Freehand pen',                 group: 'draw'     },
  { id: 'highlight', label: 'Highlight',     group: 'draw'   },
  { id: 'arrow',     label: 'Arrow',         group: 'shape'  },
  { id: 'rect',      label: 'Rectangle',     group: 'shape'  },
  { id: 'ellipse',   label: 'Ellipse',       group: 'shape'  },
  { id: 'line',      label: 'Line',          group: 'shape'  },
  { id: 'text',      label: 'Text (Enter to commit)', group: 'annotate' },
  { id: 'eraser',    label: 'Eraser (click to remove)', group: 'annotate' },
];

export default function DrawingToolbar({
  activeTool,
  setActiveTool,
  activeColor,
  setActiveColor,
  activeWidth,
  setActiveWidth,
  activeFontSizeFrac,
  setActiveFontSizeFrac,
  onUndo,
  onClear,
  hasObjects,
  disabled,
}) {
  const isTextActive = activeTool === 'text';

  return (
    <div className={`sketch-toolbar${disabled ? ' sketch-toolbar-disabled' : ''}`} role="toolbar" aria-label="Drawing tools">

      {/* ── Tool buttons ── */}
      <div className="sketch-toolbar-group">
        {TOOLS.map(tool => (
          <button
            key={tool.id}
            className={`sketch-tool-btn${activeTool === tool.id ? ' sketch-tool-btn-active' : ''}`}
            onClick={() => !disabled && setActiveTool(tool.id)}
            title={tool.label}
            disabled={disabled}
          >
            {icons[tool.id]}
          </button>
        ))}
      </div>

      <div className="sketch-toolbar-sep" />

      {/* ── Colour swatches ── */}
      <div className="sketch-toolbar-group">
        {COLORS.map(c => (
          <button
            key={c.value}
            className={`sketch-color-btn${activeColor === c.value ? ' sketch-color-btn-active' : ''}`}
            style={{ '--swatch': c.value }}
            onClick={() => !disabled && setActiveColor(c.value)}
            title={c.label}
            disabled={disabled}
          />
        ))}
      </div>

      <div className="sketch-toolbar-sep" />

      {/* ── Stroke width ── */}
      <div className="sketch-toolbar-group sketch-toolbar-group-widths">
        {WIDTHS.map(w => (
          <button
            key={w}
            className={`sketch-width-btn${activeWidth === w ? ' sketch-width-btn-active' : ''}`}
            onClick={() => !disabled && setActiveWidth(w)}
            title={`${w}px`}
            disabled={disabled}
          >
            <span className="sketch-width-dot" style={{ width: w + 4, height: w + 4 }} />
          </button>
        ))}
      </div>

      {/* ── Font size (text tool only) ── */}
      {isTextActive && (
        <>
          <div className="sketch-toolbar-sep" />
          <div className="sketch-toolbar-group">
            {FONT_SIZES.map(fs => (
              <button
                key={fs.label}
                className={`sketch-fontsize-btn${activeFontSizeFrac === fs.value ? ' sketch-fontsize-btn-active' : ''}`}
                onClick={() => setActiveFontSizeFrac(fs.value)}
                title={`Text size ${fs.label}`}
              >
                {fs.label}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="sketch-toolbar-sep" />

      {/* ── Undo / Clear ── */}
      <div className="sketch-toolbar-group">
        <button
          className="sketch-tool-btn"
          onClick={onUndo}
          title="Undo last mark (Ctrl+Z)"
          disabled={disabled || !hasObjects}
        >
          {icons.undo}
        </button>
        <button
          className="sketch-tool-btn sketch-tool-btn-danger"
          onClick={onClear}
          title="Clear all marks on this page"
          disabled={disabled || !hasObjects}
        >
          {icons.clear}
        </button>
      </div>
    </div>
  );
}
