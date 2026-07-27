import { useState } from 'react';
import ipc from '../lib/ipc';
import { useLeadsStore } from '../stores/leads.store';

export default function FilesModule() {
  const { refreshLeads } = useLeadsStore();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    setBusy(true);
    setStatus('Exporting…');
    try {
      const result = await ipc.exportLeadsCsv();
      setStatus(result.ok ? `✓ Exported ${result.count} lead(s) to ${result.filePath}` : `✗ ${result.error}`);
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    setBusy(true);
    setStatus('Importing…');
    try {
      const result = await ipc.importLeadsCsv();
      if (result.ok) {
        setStatus(`✓ Imported ${result.inserted} new lead(s) out of ${result.count} row(s)`);
        refreshLeads();
      } else {
        setStatus(`✗ ${result.error}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="files-module" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div className="module-header">
        <div className="module-header-info">
          <h2>Files</h2>
          <p>Export and manage your data files</p>
        </div>
        <div className="module-header-actions">
          <button className="btn-primary" onClick={handleExport} disabled={busy}>Export CSV</button>
          <button className="btn-secondary" onClick={handleImport} disabled={busy}>Import</button>
        </div>
      </div>

      {status && (
        <div className="dashboard-card" style={{ fontSize: 'var(--font-size-sm)', color: status.startsWith('✗') ? 'var(--red)' : 'var(--text-secondary)' }}>
          {status}
        </div>
      )}

      <div className="empty-state">
        <div className="empty-icon">📁</div>
        <div className="empty-title">Lead data lives in Leads</div>
        <div className="empty-desc">Use Export CSV to save a snapshot, or Import to bulk-add leads from a CSV file.</div>
      </div>
    </div>
  );
}
