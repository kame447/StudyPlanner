import { useEffect } from 'react';

function isIOSLikeDevice(): boolean {
  const userAgent = window.navigator.userAgent;
  const platform = window.navigator.platform;
  const maxTouchPoints = window.navigator.maxTouchPoints ?? 0;

  return (
    /iPad|iPhone|iPod/.test(userAgent) ||
    (platform === 'MacIntel' && maxTouchPoints > 1)
  );
}

function isEditableControl(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function appendMaximumScale(content: string): string {
  const entries = content
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !/^maximum-scale\s*=/i.test(entry));

  entries.push('maximum-scale=1');
  return entries.join(', ');
}

export function useIOSViewportFocusGuard(): void {
  useEffect(() => {
    if (!isIOSLikeDevice()) {
      return;
    }

    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');

    if (!viewport) {
      return;
    }

    const initialViewportContent = viewport.getAttribute('content') ?? '';
    let restoreTimer: number | null = null;

    const clearRestoreTimer = () => {
      if (restoreTimer === null) {
        return;
      }

      window.clearTimeout(restoreTimer);
      restoreTimer = null;
    };

    const enableMaximumScale = () => {
      clearRestoreTimer();
      viewport.setAttribute('content', appendMaximumScale(initialViewportContent));
    };

    const restoreViewport = () => {
      clearRestoreTimer();
      viewport.setAttribute('content', initialViewportContent);
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (isEditableControl(event.target)) {
        enableMaximumScale();
      }
    };

    const handlePotentialFocusStart = (event: Event) => {
      if (isEditableControl(event.target)) {
        enableMaximumScale();
      }
    };

    const handleFocusOut = () => {
      clearRestoreTimer();
      restoreTimer = window.setTimeout(() => {
        if (isEditableControl(document.activeElement)) {
          return;
        }

        restoreViewport();
      }, 0);
    };

    document.addEventListener('touchstart', handlePotentialFocusStart, true);
    document.addEventListener('pointerdown', handlePotentialFocusStart, true);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);

    return () => {
      clearRestoreTimer();
      document.removeEventListener('touchstart', handlePotentialFocusStart, true);
      document.removeEventListener('pointerdown', handlePotentialFocusStart, true);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
      viewport.setAttribute('content', initialViewportContent);
    };
  }, []);
}
