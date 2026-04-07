import { useCallback, useState } from 'react';

export type NoticeTone = 'info' | 'success' | 'error';

export interface NoticeState {
  tone: NoticeTone;
  text: string;
}

export type ShowNotice = (text: string, tone?: NoticeTone) => void;

interface UseNoticeStateResult {
  notice: NoticeState | null;
  showNotice: ShowNotice;
}

export function useNoticeState(): UseNoticeStateResult {
  const [notice, setNotice] = useState<NoticeState | null>(null);

  const showNotice = useCallback<ShowNotice>((text, tone = 'info') => {
    setNotice({ text, tone });
  }, []);

  return {
    notice,
    showNotice,
  };
}
