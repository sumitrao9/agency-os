import { useUIStore } from '../../stores/ui.store';

export default function RightPanel() {
  const { rightPanelTab, setRightPanelTab, toggleRightPanel } = useUIStore();

  return (
    <aside className="right-panel">
      <div className="right-panel-header">
        <h3>{rightPanelTab === 'jobs' ? 'Background Jobs' : 'Dev Tools'}</h3>
        <div className="right-panel-tabs">
          <button
            className={`right-panel-tab ${rightPanelTab === 'jobs' ? 'active' : ''}`}
            onClick={() => setRightPanelTab('jobs')}
          >
            Jobs
          </button>
          <button
            className={`right-panel-tab ${rightPanelTab === 'devtools' ? 'active' : ''}`}
            onClick={() => setRightPanelTab('devtools')}
          >
            Dev
          </button>
        </div>
        <button className="btn-icon" onClick={toggleRightPanel} title="Close Panel">✕</button>
      </div>
      <div className="right-panel-content">
        {rightPanelTab === 'jobs' ? (
          <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-sm)' }}>
            Job queue and active processes will appear here.
          </div>
        ) : (
          <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-sm)' }}>
            Developer tools and diagnostics will appear here.
          </div>
        )}
      </div>
    </aside>
  );
}
