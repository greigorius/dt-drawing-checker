import { useState } from 'react';

const STORAGE_KEY = 'dt_checker_settings';

export function loadSettings() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}

export function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export default function SettingsModal({ onClose }) {
  const [settings, setSettings] = useState(() => loadSettings());

  const update = (key, val) => setSettings(prev => ({ ...prev, [key]: val }));

  const handleSave = () => {
    saveSettings(settings);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel settings-panel">
        <div className="modal-header">
          <h2 className="modal-title">Settings</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="settings-body">
          <div className="settings-section">
            <div className="settings-section-label">Dropbox</div>

            <div className="settings-field">
              <label className="settings-label">
                Local Dropbox root path
                <span className="settings-hint">
                  The folder on this machine that contains <code>Drawing Submissions/</code>.
                  Changes per client — update when switching projects.
                </span>
              </label>
              <input
                className="settings-input"
                type="text"
                value={settings.dropboxLocalPath || ''}
                onChange={e => update('dropboxLocalPath', e.target.value)}
                placeholder="e.g. C:\Users\you\Dropbox\CLIENT NAME\TMJ Interiors"
                spellCheck={false}
              />
              <div className="settings-input-hint">
                Used by "Load Pending" to auto-fetch PDFs from your synced Dropbox folder.
                Leave blank to browse manually.
              </div>
            </div>
          </div>
        </div>

        <div className="settings-footer">
          <button className="settings-cancel-btn" onClick={onClose}>Cancel</button>
          <button className="settings-save-btn" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
