import React, { memo, useEffect } from 'react';
import { CheckCircle, AlertTriangle, Info, XCircle, X } from 'lucide-react';

const ICONS = {
  success: <CheckCircle size={16} />,
  error: <XCircle size={16} />,
  warning: <AlertTriangle size={16} />,
  info: <Info size={16} />,
};

const STYLES = {
  success: 'bg-emerald-900/95 border-emerald-500/50 text-emerald-100',
  error: 'bg-red-900/95 border-red-500/50 text-red-100',
  warning: 'bg-amber-900/95 border-amber-500/50 text-amber-100',
  info: 'bg-blue-900/95 border-blue-500/50 text-blue-100',
};

const ICON_STYLES = {
  success: 'text-emerald-400',
  error: 'text-red-400',
  warning: 'text-amber-400',
  info: 'text-blue-400',
};

const Toast = memo(function Toast({ notification, onClose }) {
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(onClose, notification.type === 'error' ? 5000 : 3000);
      return () => clearTimeout(timer);
    }
  }, [notification, onClose]);

  if (!notification) return null;
  const type = notification.type || 'success';

  return (
    <div
      className={`fixed bottom-4 right-4 flex items-center gap-2.5 px-4 py-3 rounded-md border shadow-2xl font-medium text-sm z-[60] animate-slide-up backdrop-blur-sm ${STYLES[type] || STYLES.success}`}
      role="alert"
    >
      <span className={ICON_STYLES[type]}>{ICONS[type] || ICONS.success}</span>
      <span className="max-w-xs">{notification.message}</span>
      <button onClick={onClose} className="ml-1 p-0.5 rounded hover:bg-white/10 transition-colors" aria-label="Kapat">
        <X size={14} />
      </button>
    </div>
  );
});

export default Toast;
