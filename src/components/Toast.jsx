import { useEffect } from 'react';
import { Check, X, AlertTriangle } from 'lucide-react';
import './Toast.css';

/**
 * Toast — small notification at the top-right, just below the header/profile icon.
 * toast = { id, type: 'success' | 'error', title, message }  (null = hidden)
 * Closes on the X button, or by itself after `duration` ms.
 */
export default function Toast({ toast, onClose, duration = 7000 }) {
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(onClose, duration);
    return () => clearTimeout(t);
  }, [toast, onClose, duration]);

  if (!toast) return null;
  const error = toast.type === 'error';
  return (
    <div className="toast-wrap" role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'}>
      <div key={toast.id} className={`toast${error ? ' toast--error' : ''}`}>
        <span className="toast-icon" aria-hidden="true">
          {error ? <AlertTriangle size={16} strokeWidth={2.6} /> : <Check size={16} strokeWidth={3} />}
        </span>
        <div className="toast-text">
          <strong>{toast.title}</strong>
          {toast.message && <span>{toast.message}</span>}
        </div>
        <button type="button" className="toast-close" onClick={onClose} aria-label="Dismiss notification">
          <X size={16} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}
