import { useUIStore } from '../stores/ui.store';

export default function ToastContainer() {
  const { toasts, removeToast } = useUIStore();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.type}`}>
          <span className="toast-icon">
            {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✗' : toast.type === 'warning' ? '⚠' : 'ℹ'}
          </span>
          <span className="toast-msg">{toast.message}</span>
          <button className="toast-dismiss" onClick={() => removeToast(toast.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}
