import { useCallback, useEffect, useRef, useState } from 'react';

export type NoticeTone = 'info' | 'success' | 'error';

export interface NoticeState {
  tone: NoticeTone;
  text: string;
}

export type ShowNotice = (text: string, tone?: NoticeTone) => void;

interface UseNoticeStateResult {
  notice: NoticeState | null;
  showNotice: ShowNotice;
  dismissNotice: () => void;
}

export function useNoticeState(): UseNoticeStateResult {
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const dismissTimerRef = useRef<number | null>(null);

  const dismissNotice = useCallback(() => {
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }

    setNotice(null);
  }, []);

  const showNotice = useCallback<ShowNotice>((text, tone = 'info') => {
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
    }

    setNotice({ text, tone });

    dismissTimerRef.current = window.setTimeout(() => {
      setNotice(null);
      dismissTimerRef.current = null;
    }, 3600);
  }, []);

  useEffect(
    () => () => {
      if (dismissTimerRef.current !== null) {
        window.clearTimeout(dismissTimerRef.current);
      }
    },
    [],
  );

  return {
    notice,
    showNotice,
    dismissNotice,
  };
}
