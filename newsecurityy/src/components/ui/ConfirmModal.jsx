import React, { memo } from 'react';
import { AlertTriangle, Info, AlertCircle } from 'lucide-react';
import Button from './Button';

const TYPE_CONFIG = {
  warning: { icon: AlertTriangle, color: 'text-amber-500' },
  danger: { icon: AlertCircle, color: 'text-red-500' },
  info: { icon: Info, color: 'text-blue-400' },
};

const ConfirmModal = memo(function ConfirmModal({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  onSecondary,
  confirmLabel = 'Onayla',
  cancelLabel = 'İptal',
  secondaryLabel = '',
  type = 'warning',
  confirmVariant,
  secondaryVariant = 'secondary',
}) {
  if (!isOpen) return null;

  const config = TYPE_CONFIG[type] || TYPE_CONFIG.warning;
  const IconComponent = config.icon;
  const resolvedConfirmVariant = confirmVariant || (type === 'danger' ? 'destructive' : type === 'info' ? 'primary' : 'secondary');

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
      <div className="bg-zinc-900/95 border border-zinc-700/50 rounded-md p-5 w-full max-w-sm shadow-2xl animate-in fade-in zoom-in">
        <h3 className="text-base font-bold text-white mb-3 flex gap-2 items-center">
          <IconComponent size={18} className={config.color} />
          {title}
        </h3>
        <p className="text-zinc-300 text-sm mb-5 whitespace-pre-line leading-relaxed">{message}</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button onClick={onCancel} variant="secondary" className="flex-1">{cancelLabel}</Button>
          {typeof onSecondary === 'function' && secondaryLabel ? (
            <Button onClick={onSecondary} variant={secondaryVariant} className="flex-1">{secondaryLabel}</Button>
          ) : null}
          <Button onClick={onConfirm} variant={resolvedConfirmVariant} className="flex-1">{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
});

export default ConfirmModal;
