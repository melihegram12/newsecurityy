import React, { memo, useEffect, useCallback, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { cx } from '../../lib/utils';
import { styles } from '../../lib/tokens';
import { useFocusTrap } from '../../hooks/useFocusTrap';

const Modal = memo(function Modal({
  isOpen,
  onClose,
  title,
  size = 'md',
  children,
  className = '',
  showClose = true,
}) {
  const modalRef = useRef(null);
  const titleId = useId();
  useFocusTrap(modalRef, isOpen);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape' && onClose) onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
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
      aria-labelledby={title ? titleId : undefined}
      ref={modalRef}
      onClick={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}
    >
      <div className={cx(
        'bg-popover/95 border border-border/70 rounded-lg w-full shadow-card animate-in fade-in zoom-in',
        sizeClass,
        className
      )}>
        {(title || showClose) && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
            {title && <h3 id={titleId} className="text-sm font-semibold text-foreground tracking-tight">{title}</h3>}
            {showClose && onClose && (
              <button
                onClick={onClose}
                className="modal-close-btn text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
