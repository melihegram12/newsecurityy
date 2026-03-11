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
    return () => document.removeEventListener('keydown', handleKeyDown);
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
      <div className={cx('bg-zinc-800 border border-zinc-700 rounded-xl w-full shadow-2xl animate-in fade-in zoom-in', sizeClass, className)}>
        {(title || showClose) && (
          <div className="flex items-center justify-between p-4 border-b border-zinc-700">
            {title && <h3 className="text-lg font-bold text-white">{title}</h3>}
            {showClose && onClose && (
              <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors p-1 rounded hover:bg-zinc-700">
                <X size={18} />
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
