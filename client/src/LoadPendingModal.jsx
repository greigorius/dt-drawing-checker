import { useState, useEffect, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// Reconstruct the full Dropbox-style path for auto-match parsing
// dropboxPath from ADF: "Drawing Submissions/24-367/A4.5/Pending/filename.pdf"
const DROPBOX_ROOT_DISPLAY = '/DESIGN KNOW HOW/TMJ Interiors';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' });
}

export default function LoadPendingModal({ onClose, onLoadSubmission }) {
  const [submissions, setSubmissions] = useState(null);
  const [error, setError]             = useState(null);
  const [loading, setLoading]         = useState({});  // { [id]: 'loading' | 'done' | 'error' }
  const [loadMsg, setLoadMsg]         = useState({});  // { [id]: string }

  useEffect(() => {
    fetch('/api/df-submissions')
      .then(r => r.json())
      .then(data => {
        if (data.error) setError(data.error);
        else setSubmissions(data.submissions || []);
      })
      .catch(err => setError(err.message));
  }, []);

  const handleLoad = useCallback(async (sub) => {
    setLoading(p => ({ ...p, [sub.id]: 'loading' }));
    setLoadMsg(p => ({ ...p, [sub.id]: 'Fetching PDF…' }));

    const filename  = sub.dropboxPath?.split('/').pop() || `${sub.title}.pdf`;
    const filePath  = `${DROPBOX_ROOT_DISPLAY}/${sub.dropboxPath || ''}`;

    let pdfBlob = null;

    // Try local Dropbox path first (works when DROPBOX_LOCAL_PATH is set in server/.env)
    if (sub.dropboxPath) {
      try {
        const r = await fetch(`/api/local-pdf?path=${encodeURIComponent(sub.dropboxPath)}`);
        if (r.ok) {
          pdfBlob = new Blob([await r.arrayBuffer()], { type: 'application/pdf' });
          setLoadMsg(p => ({ ...p, [sub.id]: 'Loading PDF…' }));
        } else {
          const errData = await r.json().catch(() => ({}));
          if (r.status === 503) {
            setLoadMsg(p => ({ ...p, [sub.id]: 'DROPBOX_LOCAL_PATH not set — browse for PDF manually' }));
          } else {
            setLoadMsg(p => ({ ...p, [sub.id]: `Not found locally (${errData.error || r.status}) — browse manually` }));
          }
        }
      } catch { /* fall through to manual */ }
    }

    // If no local PDF, prompt file picker
    if (!pdfBlob) {
      try {
        pdfBlob = await pickPdfFile(filename);
        if (!pdfBlob) {
          setLoading(p => ({ ...p, [sub.id]: null }));
          setLoadMsg(p => ({ ...p, [sub.id]: 'Cancelled' }));
          return;
        }
      } catch {
        setLoading(p => ({ ...p, [sub.id]: 'error' }));
        setLoadMsg(p => ({ ...p, [sub.id]: 'Failed to load PDF' }));
        return;
      }
    }

    try {
      const objectUrl = URL.createObjectURL(pdfBlob);
      const loadedPdf = await pdfjsLib.getDocument(objectUrl).promise;
      onLoadSubmission({ sub, pdfDoc: loadedPdf, filename, filePath, blob: pdfBlob });
      setLoading(p => ({ ...p, [sub.id]: 'done' }));
      setLoadMsg(p => ({ ...p, [sub.id]: 'Loaded ✓' }));
    } catch (err) {
      setLoading(p => ({ ...p, [sub.id]: 'error' }));
      setLoadMsg(p => ({ ...p, [sub.id]: `Error: ${err.message}` }));
    }
  }, [onLoadSubmission]);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel load-pending-panel">
        <div className="modal-header">
          <h2 className="modal-title">Load Pending Drawings</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="load-pending-body">
          {!submissions && !error && (
            <div className="load-pending-empty">
              <div className="spinner" style={{ margin: '0 auto 8px' }} />
              Fetching submissions from Axiom Drawing Flow…
            </div>
          )}
          {error && (
            <div className="load-pending-error">Could not load submissions: {error}</div>
          )}
          {submissions && submissions.length === 0 && (
            <div className="load-pending-empty">No drawings currently awaiting review.</div>
          )}
          {submissions && submissions.length > 0 && (
            <table className="pending-table">
              <thead>
                <tr>
                  <th>Drawing</th>
                  <th>Stage</th>
                  <th>R</th>
                  <th>DT</th>
                  <th>Submitted</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {submissions.map(sub => {
                  const state = loading[sub.id];
                  const msg   = loadMsg[sub.id];
                  return (
                    <tr key={sub.id} className={state === 'done' ? 'pending-row-done' : ''}>
                      <td className="pending-col-drawing">
                        <div className="pending-drawing-num">{sub.drawingNo || sub.title}</div>
                        {sub.taskCode && <div className="pending-task-code">{sub.taskCode}</div>}
                      </td>
                      <td className="pending-col-stage">{sub.stage}</td>
                      <td className="pending-col-round">R{sub.qaRound}</td>
                      <td className="pending-col-dt">{sub.dtName || '—'}</td>
                      <td className="pending-col-date">{formatDate(sub.submitted)}</td>
                      <td className="pending-col-action">
                        {state === 'done' ? (
                          <span className="pending-loaded">✓ Loaded</span>
                        ) : state === 'loading' ? (
                          <span className="pending-loading-msg">{msg || 'Loading…'}</span>
                        ) : (
                          <>
                            <button
                              className="pending-load-btn"
                              onClick={() => handleLoad(sub)}
                            >
                              Load
                            </button>
                            {msg && <div className="pending-msg">{msg}</div>}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="load-pending-footer">
          <span className="load-pending-hint">
            Auto-loads from local Dropbox if <code>DROPBOX_LOCAL_PATH</code> is set in <code>server/.env</code>
          </span>
          <button className="modal-close-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// Opens a native file picker and returns a Blob for the selected PDF
function pickPdfFile(suggestedName) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      resolve(new Blob([file], { type: 'application/pdf' }));
    };
    input.oncancel = () => resolve(null);
    input.onerror  = reject;
    input.click();
  });
}
