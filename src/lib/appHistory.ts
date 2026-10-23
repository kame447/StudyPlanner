/** pushState does not emit popstate; notify retained same-document screens separately. */
export const APP_HISTORY_CHANGE = 'studyplanner:historychange';

export function subscribeAppHistory(listener: () => void): () => void {
  if (typeof window === 'undefined' || !window.addEventListener) return () => {};
  window.addEventListener('popstate', listener);
  window.addEventListener(APP_HISTORY_CHANGE, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(APP_HISTORY_CHANGE, listener);
  };
}
