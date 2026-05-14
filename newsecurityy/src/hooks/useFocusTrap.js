import { useEffect, useCallback } from 'react';

/**
 * Modal/dialog icin focus trap hook.
 * - Acilista ilk focusable elemente odaklanir
 * - Tab ile dongu saglar (ilk <-> son)
 * - Kapanista onceki elemente geri doner
 */
export function useFocusTrap(ref, isOpen) {
  const handleKeyDown = useCallback((e) => {
    if (e.key !== 'Tab') return;

    const container = ref.current;
    if (!container) return;

    const focusable = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (!first || !last) return;

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, [ref]);

  useEffect(() => {
    if (!isOpen) return;

    const container = ref.current;
    if (!container) return;

    // Onceki aktif elementi kaydet
    const previousActive = document.activeElement;

    // Acilista ilk focusable'a odaklan
    const focusable = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const autoFocus = container.querySelector('[autofocus]');
    const firstFocusable = autoFocus || focusable[0];
    if (firstFocusable) {
      // Kisa bir gecikme ile focus (DOM render sonrasi)
      setTimeout(() => firstFocusable.focus(), 50);
    }

    container.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
      // Kapanista onceki elemente geri don
      if (previousActive && typeof previousActive.focus === 'function') {
        previousActive.focus();
      }
    };
  }, [isOpen, ref, handleKeyDown]);
}
