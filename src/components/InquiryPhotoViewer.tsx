import { useEffect, useRef, useState } from 'react';
import type { InquiryAttachment } from '../../shared/inquiryAttachments';
import { readInquiryAttachment } from '../services/inquiryAttachmentService';

export function InquiryPhotoViewer({ receiptId, slot, photo }: { receiptId: string; slot: number; photo: InquiryAttachment }) {
  const [state, setState] = useState<{ kind: 'closed' | 'loading' | 'error' | 'open'; url?: string; error?: string }>({ kind: 'closed' });
  const request = useRef<AbortController | null>(null);
  const objectUrl = useRef<string | null>(null);
  const clear = () => {
    request.current?.abort(); request.current = null;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  };
  useEffect(() => () => { clear(); }, [receiptId, slot, photo.sha256]);
  const open = async () => {
    clear();
    const controller = new AbortController(); request.current = controller;
    setState({ kind: 'loading' });
    try {
      const blob = await readInquiryAttachment(receiptId, slot, photo, controller.signal);
      if (controller.signal.aborted || request.current !== controller) return;
      objectUrl.current = URL.createObjectURL(blob);
      setState({ kind: 'open', url: objectUrl.current });
    } catch (error) {
      if (!controller.signal.aborted && request.current === controller) setState({ kind: 'error', error: error instanceof Error ? error.message : '写真を取得できませんでした。' });
    }
  };
  return <section className="inquiry-photo-viewer" aria-label={`写真${slot + 1}`}>
    <div className="inquiry-photo-controls">
      <span>写真{slot + 1}（{(photo.byteLength / 1024 / 1024).toFixed(1)}MB）</span>
      {(state.kind === 'closed' || state.kind === 'error') && <button type="button" className="ghost-button" onClick={() => { void open(); }}>{state.kind === 'error' ? '写真を再取得' : '写真を開く'}</button>}
      {state.kind !== 'closed' && <button type="button" className="ghost-button" onClick={() => { clear(); setState({ kind: 'closed' }); }}>写真を閉じる</button>}
    </div>
    {state.kind === 'loading' && <p role="status">写真を取得しています</p>}
    {state.kind === 'error' && <p role="alert">{state.error}</p>}
    {state.kind === 'open' && <img className="inquiry-photo-full" src={state.url} alt={`お問い合わせに添付された写真${slot + 1}`} onError={() => { clear(); setState({ kind: 'error', error: '写真を表示できませんでした。' }); }} />}
  </section>;
}
