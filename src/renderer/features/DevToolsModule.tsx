import { useState, useEffect, useCallback } from 'react';
import ipc from '../lib/ipc';
import { useLeadsStore } from '../stores/leads.store';
import type { Diagnostics } from '@shared/types';

function formatBytes(bytes: number): string {
  if (!bytes) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function DevToolsModule() {
  const { leads, leadPriorityCache } = useLeadsStore();
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDiag(await ipc.getDiagnostics());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const cachedRules = Object.keys(leadPriorityCache).length;
  const errors = diag?.errors ?? [];

  return (
    <div className="devtools-module" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div className="module-header">
        <div className="module-header-info">
          <h2>Developer Tools</h2>
          <p>System diagnostics and debug information</p>
        </div>
        <div className="toolbar-actions">
          <button className="btn-secondary" onClick={load} disabled={loading}>
            {loading ? '⟳' : '↻'} Refresh
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-3)' }}>
        <div className="dashboard-card">
          <div className="dashboard-card-header">
            <span className="card-title">Database</span>
            <span className="card-icon">🗄</span>
          </div>
          <div className="dashboard-stat">
            <div className="stat-value">{leads.length}</div>
            <div className="stat-label">Total Leads</div>
            <div className="stat-detail">DB Size: {formatBytes(diag?.dbSizeBytes ?? 0)}</div>
          </div>
        </div>

        <div className="dashboard-card">
          <div className="dashboard-card-header">
            <span className="card-title">Cache</span>
            <span className="card-icon">⚡</span>
          </div>
          <div className="dashboard-stat">
            <div className="stat-value">{cachedRules}</div>
            <div className="stat-label">Cached Rule Results</div>
          </div>
        </div>

        <div className="dashboard-card">
          <div className="dashboard-card-header">
            <span className="card-title">Connector</span>
            <span className="card-icon">🔌</span>
          </div>
          <div className="dashboard-stat">
            <div className="stat-value" style={{ color: diag?.connectorPort ? 'var(--green)' : 'var(--text-tertiary)' }}>
              {diag?.connectorPort ?? '—'}
            </div>
            <div className="stat-label">{diag?.connectorPort ? 'Listening on port' : 'Not running'}</div>
          </div>
        </div>

        <div className="dashboard-card">
          <div className="dashboard-card-header">
            <span className="card-title">Errors</span>
            <span className="card-icon">⚠</span>
          </div>
          <div className="dashboard-stat">
            <div className="stat-value" style={{ color: errors.length ? 'var(--red)' : 'var(--green)' }}>{errors.length}</div>
            <div className="stat-label">Recorded this session</div>
          </div>
        </div>
      </div>

      <div className="dashboard-card">
        <h4 style={{ marginBottom: 'var(--space-3)' }}>Runtime</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', fontSize: 'var(--font-size-sm)' }}>
          <div><strong>Status:</strong> {diag?.status || '—'}</div>
          {Object.entries(diag?.env ?? {}).map(([k, v]) => (
            <div key={k}><strong>{k}:</strong> {String(v)}</div>
          ))}
          <div style={{ color: 'var(--text-tertiary)', wordBreak: 'break-all' }}>
            <strong>Data dir:</strong> {diag?.userDataDir || '—'}
          </div>
        </div>
      </div>

      <div className="dashboard-card">
        <h4 style={{ marginBottom: 'var(--space-3)' }}>System Log</h4>
        {errors.length === 0 ? (
          <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-sm)' }}>
            {loading ? 'Loading diagnostics…' : 'No errors recorded'}
          </div>
        ) : (
          <div style={{ maxHeight: 300, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {errors.slice().reverse().map((err, i) => (
              <div key={i} className="dev-log-line" style={{ display: 'flex', gap: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>
                <span style={{ color: 'var(--text-tertiary)', flexShrink: 0, fontFamily: 'var(--font-mono)' }}>
                  {err.at.slice(11, 19)}
                </span>
                <span style={{ color: 'var(--red)' }}>{err.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
