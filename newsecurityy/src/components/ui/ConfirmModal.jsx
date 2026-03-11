import React, { memo } from 'react';
import { AlertTriangle } from 'lucide-react';
import Button from './Button';

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
  const resolvedConfirmVariant = confirmVariant || (type === 'danger' ? 'destructive' : type === 'info' ? 'primary' : 'secondary');
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="ui-card p-6 w-full max-w-sm shadow-2xl animate-in fade-in zoom-in">
        <h3 className="text-xl font-bold text-white mb-4 flex gap-2 items-center">
          <AlertTriangle className={type === 'danger' ? 'text-red-500' : 'text-orange-500'} />
          {title}
        </h3>
        <p className="text-slate-300 text-sm mb-6 whitespace-pre-line">{message}</p>
        <div className="flex flex-col sm:flex-row gap-3">
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
