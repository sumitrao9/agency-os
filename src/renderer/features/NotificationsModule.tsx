import { useUIStore } from '../stores/ui.store';

export default function NotificationsModule() {
  const { toasts, removeToast } = useUIStore();

  return (
    <div className="notifications-module" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div className="module-header">
        <div className="module-header-info">
          <h2>Notifications</h2>
          <p>System notifications and alerts</p>
        </div>
      </div>

      <div className="dashboard-card">
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
      </div>
    </div>
  );
}
