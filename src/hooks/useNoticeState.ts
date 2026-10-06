import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

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

export function useNoticeState(autoDismiss = true): UseNoticeStateResult {
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const noticeRef = useRef<NoticeState | null>(null);
  const durationRef = useRef(3600);
  const autoDismissRef = useRef(autoDismiss);
  const dismissTimerRef = useRef<number | null>(null);

  const dismissNotice = useCallback(() => {
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }

    noticeRef.current = null;
    setNotice(null);
  }, []);

  const showNotice = useCallback<ShowNotice>((text, tone = 'info', options) => {
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
    }

    const nextNotice: NoticeState = {
      text,
      tone,
      actionLabel: options?.actionLabel,
      onAction: options?.onAction,
      placement: options?.placement,
    };
    noticeRef.current = nextNotice;
    setNotice(nextNotice);
    durationRef.current = options?.durationMs ?? 3600;
    dismissTimerRef.current = null;
    if (!autoDismissRef.current) return;

    dismissTimerRef.current = window.setTimeout(() => {
      noticeRef.current = null;
      setNotice(null);
      dismissTimerRef.current = null;
    }, options?.durationMs ?? 3600);
  }, []);

  useLayoutEffect(() => {
    autoDismissRef.current = autoDismiss;
    if (dismissTimerRef.current !== null) window.clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = null;
    if (autoDismiss && noticeRef.current) {
      dismissTimerRef.current = window.setTimeout(dismissNotice, durationRef.current);
    }
  }, [autoDismiss, dismissNotice]);

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
