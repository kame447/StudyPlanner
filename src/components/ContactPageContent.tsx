import { useMemo, useState, useSyncExternalStore, type FormEvent } from 'react';
import { InquiryPhotoPicker } from './InquiryPhotoPicker';
import { PublicPageLink } from './PublicPageLink';
import { INQUIRY_BODY_MAX_LENGTH } from '../features/support/inquiry';
import type { AuthSessionService } from '../services/authSession';
import { getInquiryDraft, type InquiryDraft } from '../services/inquiryDraft';

export function InquiryForm({ draft }: { draft: InquiryDraft }) {
  const state = useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getServerSnapshot);
  const [preparingPhotos, setPreparingPhotos] = useState(false);
  const accepted = ['uploading', 'upload-failed', 'needs-files', 'sent'].includes(state.phase);
  const recovering = ['recovering', 'recovery-failed'].includes(state.phase);
  const send = (event: FormEvent) => { event.preventDefault(); if (!preparingPhotos) void draft.send(); };
  if (accepted || recovering) return <section className="legal-section" aria-busy={['uploading', 'recovering'].includes(state.phase)}>
    <h2>{accepted ? 'お問い合わせ本文を受け付けました' : '前回のお問い合わせを確認'}</h2>
    <p className="detail-note">受付番号: {state.marker?.receipt}</p>
    {state.phase === 'recovering' && <p role="status">受付状況を確認しています</p>}
    {state.phase === 'uploading' && <p role="status">写真を送信しています。本文は再送しません。</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {state.phase === 'recovery-failed' && <button className="primary-button" type="button" onClick={() => { void draft.recover(); }}>受付状況を再確認</button>}
    {(state.phase === 'needs-files' || (state.phase === 'upload-failed' && !state.photos.length)) && <>
      <p className="detail-note">本文は再送せず、この受付に写真を追加します。受付時と同じ写真{state.marker?.attachments?.length}枚を選び直してください。</p>
      <InquiryPhotoPicker photos={state.photos} disabled={false} onChange={(photos) => draft.restorePhotos(photos)} onPreparing={setPreparingPhotos} />
    </>}
    {state.phase === 'upload-failed' && state.photos.length > 0 && <button className="primary-button" type="button" onClick={() => { void draft.upload(); }}>写真だけ再送する</button>}
    {state.phase === 'sent' && <>
      <p role="status">{state.marker?.attachments ? 'お問い合わせと写真を受け付けました。' : 'お問い合わせを受け付けました。'}</p>
      <button className="ghost-button" type="button" onClick={() => draft.startAnother()}>別のお問い合わせを送る</button>
    </>}
  </section>;
  return <form className="section-stack" onSubmit={send} aria-busy={state.phase === 'sending'}>
    <div className="field">
      <label htmlFor="inquiry-body"><span>お問い合わせ内容</span></label>
      <textarea id="inquiry-body" rows={8} value={state.body} onChange={(event) => draft.setBody(event.target.value)} maxLength={INQUIRY_BODY_MAX_LENGTH}
        disabled={!['editing', 'restore-input'].includes(state.phase)} aria-describedby="inquiry-guidance inquiry-count" required />
    </div>
    <span id="inquiry-count" className="detail-note">{state.body.length} / {INQUIRY_BODY_MAX_LENGTH}文字</span>
    {state.phase === 'restore-input' && <p className="detail-note">前回の受付はまだ確認できません。本文を再入力すると、同じ受付番号で再試行します。{state.marker?.attachments ? '写真は本文の受付後に選び直せます。' : ''}</p>}
    {state.phase !== 'restore-input' && <InquiryPhotoPicker photos={state.photos} disabled={state.phase !== 'editing'} onChange={(photos) => draft.setPhotos(photos)} onPreparing={setPreparingPhotos} />}
    <p id="inquiry-guidance" className="detail-note">内容・添付写真とアカウントの識別情報を管理者へ送信します。パスワードなどの機密情報は入力しないでください。連続送信は1分に1件までです。</p>
    {state.error && <p role="alert">{state.error}</p>}
    <button className="primary-button" type="submit" disabled={state.phase === 'sending' || preparingPhotos || !state.body.trim()}>
      {state.phase === 'sending' ? '送信中…' : state.phase === 'failed' ? '同じ内容で再試行' : state.phase === 'restore-input' ? '同じ受付番号で再試行' : '送信する'}
    </button>
  </form>;
}

export function ContactPageContent({ authSession }: { authSession?: AuthSessionService } = {}) {
  const draft = useMemo(() => getInquiryDraft(authSession), [authSession]);
  const session = useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getServerSnapshot);
  return <>
    {!session.resolved ? <p role="status">ログイン状態を確認しています</p>
      : !draft.auth.available ? <p role="alert">現在、お問い合わせに接続できません。</p>
        : session.userId ? <InquiryForm key={session.userId} draft={draft} />
          : <section><p>お問い合わせを送信するにはログインしてください。</p><PublicPageLink className="primary-button" href="/">ログイン画面へ</PublicPageLink></section>}
  </>;
}
