import React, { memo, useEffect } from 'react';
import { CheckCircle, AlertTriangle, Info, XCircle, X } from 'lucide-react';

const ICONS = {
  success: <CheckCircle size={18} />,
  error: <XCircle size={18} />,
  warning: <AlertTriangle size={18} />,
  info: <Info size={18} />,
};

const STYLES = {
  success: 'bg-green-600 border-green-500',
  error: 'bg-red-600 border-red-500',
  warning: 'bg-orange-500 border-orange-400',
  info: 'bg-blue-600 border-blue-500',
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
      className={`fixed bottom-5 right-5 flex items-center gap-3 px-5 py-3.5 rounded-xl border shadow-2xl text-white font-semibold text-sm z-[60] animate-slide-up ${STYLES[type] || STYLES.success}`}
      role="alert"
    >
      {ICONS[type] || ICONS.success}
      <span className="max-w-xs">{notification.message}</span>
      <button onClick={onClose} className="ml-1 p-0.5 rounded hover:bg-white/20 transition-colors" aria-label="Kapat">
        <X size={14} />
      </button>
    </div>
  );
});

export default Toast;
