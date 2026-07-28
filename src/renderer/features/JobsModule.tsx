import { useState, useEffect } from 'react';
import ipc from '../lib/ipc';
import type { AutomationConsoleState } from '@shared/types';
import { PageHeader, Card, StatTile } from '../components/ui';

export default function JobsModule() {
  const [state, setState] = useState<AutomationConsoleState>({
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
      const s = await ipc.getAutomationConsoleState();
      setState(s);
    } catch {}
  };

  const running = state.jobs.filter((j) => j.status === 'running').length;
  const failed = state.jobs.filter((j) => j.status === 'failed').length;

  return (
    <div className="jobs-module" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <PageHeader title="Jobs" description="Background job queue and execution status" />

      <div className="kpi-grid">
        <StatTile accent="blue" label="Running" value={running} />
        <StatTile accent="purple" label="Queued" value={state.queue.length} />
        <StatTile accent={failed > 0 ? 'orange' : 'green'} label="Failed" value={failed} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
        {/* Active Jobs */}
        <Card>
          <h4 style={{ marginBottom: 'var(--space-3)' }}>Active Jobs ({state.jobs.length})</h4>
          {state.jobs.map((job) => (
            <div key={job.id} className="job-item">
              <div className="job-header">
                <span className="job-name">{job.name}</span>
                <span className={`badge badge-${job.status === 'running' ? 'green' : job.status === 'paused' ? 'yellow' : job.status === 'failed' ? 'red' : 'accent'}`}>
                  {job.status}
                </span>
              </div>
              <div className="job-progress">
                <div className="progress-bar">
                  <div className={`progress-bar-fill ${job.status === 'paused' ? 'paused' : job.status === 'failed' ? 'error' : ''}`} style={{ width: `${job.progress}%` }} />
                </div>
                <span className="progress-text">{job.progress}%</span>
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
                Retries: {job.retries}
              </div>
            </div>
          ))}
          {state.jobs.length === 0 && (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-sm)' }}>No active jobs</div>
          )}
        </Card>

        {/* Queue & Logs */}
        <Card>
          <h4 style={{ marginBottom: 'var(--space-3)' }}>Queue ({state.queue.length})</h4>
          {state.queue.map((item) => (
            <div key={item.id} className="job-queue-item">
              <span className="queue-indicator" />
              <div>
                <div style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)' }}>{item.label}</div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>{item.detail}</div>
              </div>
            </div>
          ))}
          {state.queue.length === 0 && (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-sm)' }}>Queue is empty</div>
          )}
        </Card>
      </div>
    </div>
  );
}
