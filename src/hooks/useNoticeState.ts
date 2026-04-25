import { useCallback, useEffect, useRef, useState } from 'react';

export type NoticeTone = 'info' | 'success' | 'error';

export interface NoticeState {
  tone: NoticeTone;
  text: string;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  placement?: 'top' | 'bottom';
}

export interface ShowNoticeOptions {
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  durationMs?: number;
  placement?: 'top' | 'bottom';
}

export type ShowNotice = (
  text: string,
  tone?: NoticeTone,
  options?: ShowNoticeOptions,
) => void;

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

  const showNotice = useCallback<ShowNotice>((text, tone = 'info', options) => {
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
    }

    setNotice({
      text,
      tone,
      actionLabel: options?.actionLabel,
      onAction: options?.onAction,
      placement: options?.placement,
    });

    dismissTimerRef.current = window.setTimeout(() => {
      setNotice(null);
      dismissTimerRef.current = null;
    }, options?.durationMs ?? 3600);
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
