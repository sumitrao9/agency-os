import { useUIStore } from '../stores/ui.store';
import { PageHeader, Card, StatTile } from '../components/ui';

export default function NotificationsModule() {
  const { toasts, removeToast } = useUIStore();
  const errorCount = toasts.filter((t) => t.type === 'error').length;

  return (
    <div className="notifications-module" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <PageHeader title="Notifications" description="System notifications and alerts" />

      <div className="kpi-grid">
        <StatTile accent="blue" label="Total" value={toasts.length} />
        <StatTile accent={errorCount > 0 ? 'orange' : 'green'} label="Errors" value={errorCount} />
      </div>

      <Card>
        <h4 style={{ marginBottom: 'var(--space-3)' }}>Recent Notifications</h4>
        {toasts.length === 0 ? (
          <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-sm)' }}>
            No recent notifications
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {toasts.map((toast) => (
              <div
                key={toast.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  padding: 'var(--space-2) var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  background: toast.type === 'error' ? 'var(--red-bg)' :
                    toast.type === 'warning' ? 'var(--yellow-bg)' :
                    toast.type === 'success' ? 'var(--green-bg)' : 'var(--bg-hover)',
                }}
              >
                <span style={{ fontSize: 'var(--font-size-lg)' }}>
                  {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✗' : toast.type === 'warning' ? '⚠' : 'ℹ'}
                </span>
                <span style={{ flex: 1, fontSize: 'var(--font-size-sm)' }}>{toast.message}</span>
                <button className="btn-icon" onClick={() => removeToast(toast.id)} style={{ fontSize: 'var(--font-size-xs)' }}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
