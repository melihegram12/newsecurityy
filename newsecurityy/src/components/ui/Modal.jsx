import React, { memo, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { cx } from '../../lib/utils';
import { styles } from '../../lib/tokens';

const Modal = memo(function Modal({
  isOpen,
  onClose,
  title,
  size = 'md',
  children,
  className = '',
  showClose = true,
}) {
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape' && onClose) onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const sizeClass =
    size === 'sm' ? 'max-w-sm' :
    size === 'lg' ? 'max-w-3xl' :
    size === 'xl' ? 'max-w-5xl' :
    size === 'full' ? 'max-w-[95vw]' :
    'max-w-lg';

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}
    >
      <div className={cx(
        'bg-zinc-900/95 border border-zinc-700/50 rounded-md w-full shadow-2xl animate-in fade-in zoom-in',
        sizeClass,
        className
      )}>
        {(title || showClose) && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700/40">
            {title && <h3 className="text-sm font-bold text-white tracking-tight">{title}</h3>}
            {showClose && onClose && (
              <button
                onClick={onClose}
                className="text-zinc-500 hover:text-white transition-colors p-1.5 rounded hover:bg-white/10"
                aria-label="Kapat"
              >
                <X size={16} />
              </button>
            )}
          </div>
        )}
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
});

export default Modal;
