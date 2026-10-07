import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function isVisible(element: HTMLElement): boolean {
  return element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true';
}

export function useDialogFocus<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const dialogRef = useRef<T | null>(null);
  const initialFocusRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => {
      const target = initialFocusRef.current ?? dialogRef.current;
      if (target && isVisible(target)) target.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      const dialog = dialogRef.current;
      // A retained screen may be hidden while another full-screen surface is open.
      if (!dialog || !isVisible(dialog)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter(isVisible);

      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleKeyDown);
      const previousFocus = previousFocusRef.current;
      window.requestAnimationFrame(() => {
        if (previousFocus?.isConnected && isVisible(previousFocus)) previousFocus.focus();
      });
    };
  }, [open]);

  return { dialogRef, initialFocusRef };
}
