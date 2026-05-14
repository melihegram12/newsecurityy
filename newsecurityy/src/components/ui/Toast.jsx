import React, { memo, useEffect } from 'react';
import { CheckCircle, AlertTriangle, Info, XCircle, X } from 'lucide-react';

const ICONS = {
  success: <CheckCircle size={16} />,
  error: <XCircle size={16} />,
  warning: <AlertTriangle size={16} />,
  info: <Info size={16} />,
};

const STYLES = {
  success: 'bg-popover/95 border-emerald-500/30 text-emerald-100',
  error: 'bg-popover/95 border-red-500/30 text-red-100',
  warning: 'bg-popover/95 border-amber-500/30 text-amber-100',
  info: 'bg-popover/95 border-sky-500/30 text-sky-100',
};

const ICON_STYLES = {
  success: 'text-emerald-400',
  error: 'text-red-400',
  warning: 'text-amber-400',
  info: 'text-sky-300',
};

const Toast = memo(function Toast({ notification, onClose }) {
  useEffect(() => {
    if (notification) {
      const autoCloseMs = { error: 0, warning: 5000, info: 3000, success: 3000 };
      const delay = autoCloseMs[notification.type] ?? 3000;
      if (delay > 0) {
        const timer = setTimeout(onClose, delay);
        return () => clearTimeout(timer);
      }
    }
  }, [notification, onClose]);

  if (!notification) return null;
  const type = notification.type || 'success';

  return (
    <div
      className={`fixed bottom-4 right-4 flex items-center gap-2.5 px-4 py-3 rounded-lg border shadow-card font-medium text-sm z-[60] animate-slide-up backdrop-blur-md ${STYLES[type] || STYLES.success}`}
      role="alert"
      aria-live={type === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      <span className={ICON_STYLES[type]}>{ICONS[type] || ICONS.success}</span>
      <span className="max-w-xs">{notification.message}</span>
      <button onClick={onClose} className="ml-1 p-0.5 rounded hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50" aria-label="Kapat">
        <X size={14} />
      </button>
    </div>
  );
});

export default Toast;
