import { useState, useEffect } from 'react';
import ipc from '../lib/ipc';
import type { AutomationConsoleState } from '@shared/types';
import { PageHeader, Card, StatTile } from '../components/ui';

export default function AutomationsModule() {
  const [consoleState, setConsoleState] = useState<AutomationConsoleState>({
    jobs: [],
    queue: [],
    alerts: [],
  });

  useEffect(() => {
    loadState();
    const interval = setInterval(loadState, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadState = async () => {
    try {
      const state = await ipc.getAutomationConsoleState();
      setConsoleState(state);
    } catch {}
  };

  const handleAction = async (type: string, jobId?: string) => {
    try {
      const nextState = await ipc.applyAutomationConsoleAction({ type, jobId: jobId || null });
      setConsoleState(nextState);
    } catch {}
  };

  return (
    <div className="automations-module" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <PageHeader
        title="Automations"
        description="Monitor and control your automation workflows"
        actions={<button className="btn-secondary" onClick={loadState}>↻ Refresh</button>}
      />

      <div className="kpi-grid">
        <StatTile accent="blue" label="Active Jobs" value={consoleState.jobs.length} />
        <StatTile accent="purple" label="Queued" value={consoleState.queue.length} />
        <StatTile accent={consoleState.alerts.length > 0 ? 'orange' : 'green'} label="Alerts" value={consoleState.alerts.length} />
      </div>

      {/* Active Jobs */}
      <Card>
        <h4 style={{ marginBottom: 'var(--space-3)' }}>Active Jobs</h4>
        {consoleState.jobs.length === 0 ? (
          <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-sm)' }}>No active jobs</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {consoleState.jobs.map((job) => (
              <div key={job.id} className="job-item">
                <div className="job-header">
                  <span className="job-name">{job.name}</span>
                  <span className={`badge badge-${job.status === 'running' ? 'green' : job.status === 'completed' ? 'blue' : job.status === 'paused' ? 'yellow' : job.status === 'failed' ? 'red' : job.status === 'needs-attention' ? 'orange' : 'accent'}`}>
                    {job.status}
                  </span>
                </div>
                <div className="job-progress">
                  <div className="progress-bar">
                    <div className="progress-bar-fill" style={{ width: `${job.progress}%` }} />
                  </div>
                  <span className="progress-text">{job.progress}%</span>
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
                  {job.profile}{job.retries > 0 ? ` · ${job.retries} error(s)` : ''}
                </div>
                {job.status === 'running' && (
                  <div className="job-actions">
                    <button onClick={() => handleAction('cancel-job', job.id)}>Cancel</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Queue */}
      <Card>
        <h4 style={{ marginBottom: 'var(--space-3)' }}>Queue</h4>
        {consoleState.queue.length === 0 ? (
          <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-sm)' }}>Queue is empty</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {consoleState.queue.map((item) => (
              <div key={item.id} className="job-queue-item">
                <span className="queue-indicator" />
                <div>
                  <div style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)' }}>{item.label}</div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>{item.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Alerts */}
      <Card>
        <h4 style={{ marginBottom: 'var(--space-3)' }}>Alerts</h4>
        {consoleState.alerts.length === 0 ? (
          <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-sm)' }}>No alerts</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {consoleState.alerts.map((alert) => (
              <div key={alert.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)', background: alert.severity === 'warning' ? 'var(--yellow-bg)' : alert.severity === 'error' ? 'var(--red-bg)' : alert.severity === 'success' ? 'var(--green-bg)' : 'var(--bg-hover)' }}>
                <span style={{ fontSize: 'var(--font-size-sm)' }}>{alert.label}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
