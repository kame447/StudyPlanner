import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { INQUIRY_BODY_MAX_LENGTH, type InquirySubmission } from '../features/support/inquiry';
import { createAuthSessionService, type AuthSessionService } from '../services/authSession';
import { submitInquiry } from '../services/inquiryService';

type SubmissionState =
  | { kind: 'editing' }
  | { kind: 'sending'; submission: InquirySubmission }
  | { kind: 'failed'; submission: InquirySubmission }
  | { kind: 'sent'; receipt: string };

export function InquiryForm({ userId }: { userId: string }) {
  const [body, setBody] = useState('');
  const [state, setState] = useState<SubmissionState>({ kind: 'editing' });
  const [validation, setValidation] = useState('');
  const busy = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current || state.kind === 'sent') return;
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > INQUIRY_BODY_MAX_LENGTH) {
      setValidation(`お問い合わせ内容を1〜${INQUIRY_BODY_MAX_LENGTH}文字で入力してください。`);
      return;
    }
    const submission = state.kind === 'failed'
      ? state.submission
      : { requestId: crypto.randomUUID(), body: trimmed };
    busy.current = true;
    setValidation('');
    setState({ kind: 'sending', submission });
    try {
      const receipt = await submitInquiry(userId, submission);
      if (active.current) setState({ kind: 'sent', receipt });
    } catch {
      if (active.current) setState({ kind: 'failed', submission });
    } finally {
      busy.current = false;
    }
  };

  if (state.kind === 'sent') {
    return (
      <section className="legal-section" role="status">
        <h2>お問い合わせを受け付けました</h2>
        <p className="detail-note">受付番号: {state.receipt}</p>
        <button className="ghost-button" type="button" onClick={() => {
          setBody('');
          setState({ kind: 'editing' });
        }}>別のお問い合わせを送る</button>
      </section>
    );
  }

  return (
    <form className="section-stack" onSubmit={(event) => { void send(event); }} aria-busy={state.kind === 'sending'}>
      <label className="field" htmlFor="inquiry-body">
        <span>お問い合わせ内容</span>
        <textarea
          id="inquiry-body"
          rows={8}
          value={body}
          onChange={(event) => { setBody(event.target.value); setValidation(''); }}
          maxLength={INQUIRY_BODY_MAX_LENGTH}
          disabled={state.kind !== 'editing'}
          aria-describedby="inquiry-guidance inquiry-count"
          required
        />
      </label>
      <span id="inquiry-count" className="detail-note">{body.length} / {INQUIRY_BODY_MAX_LENGTH}文字</span>
      <p id="inquiry-guidance" className="detail-note">内容とアカウントの識別情報を管理者へ送信します。パスワードなどの機密情報は入力しないでください。連続送信は1分に1件までです。</p>
      {validation && <p role="alert">{validation}</p>}
      {state.kind === 'failed' && <p role="alert">送信結果を確認できませんでした。この画面のまま接続を確認し、再試行してください。連続送信は1分後にお試しください。</p>}
      <button className="primary-button" type="submit" disabled={state.kind === 'sending' || !body.trim()}>
        {state.kind === 'sending' ? '送信中…' : state.kind === 'failed' ? '同じ内容で再試行' : '送信する'}
      </button>
    </form>
  );
}

export function ContactPage({ authSession: injectedAuthSession }: { authSession?: AuthSessionService } = {}) {
  const authSession = useMemo(() => injectedAuthSession ?? createAuthSessionService(), [injectedAuthSession]);
  const [session, setSession] = useState<{ resolved: boolean; userId: string | null }>({ resolved: false, userId: null });
  useEffect(() => {
    setSession({ resolved: !authSession.available, userId: null });
    if (!authSession.available) return;
    return authSession.subscribe((user) => setSession({ resolved: true, userId: user?.id ?? null }));
  }, [authSession]);

  return (
    <main className="legal-page-shell">
      <article className="legal-page-card">
        <a className="legal-back-link" href="/">Laplanceへ戻る</a>
        <header className="legal-page-header">
          <p className="eyebrow">Laplance</p>
          <h1>お問い合わせ</h1>
        </header>
        {!session.resolved ? <p role="status">ログイン状態を確認しています</p>
          : !authSession.available ? <p role="alert">現在、お問い合わせに接続できません。</p>
            : session.userId ? <InquiryForm key={session.userId} userId={session.userId} />
              : <section><p>お問い合わせを送信するにはログインしてください。</p><a className="primary-button" href="/">ログイン画面へ</a></section>}
      </article>
    </main>
  );
}
