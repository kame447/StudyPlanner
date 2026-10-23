import { LoaderCircle } from 'lucide-react';
import { Component, lazy, Suspense, type PropsWithChildren } from 'react';
import type { AuthSessionService } from '../services/authSession';
import { PublicPageLink } from './PublicPageLink';

const ContactPageContent = lazy(() => import('./ContactPageContent').then(module => ({ default: module.ContactPageContent })));

class ContactContentBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <section>
      <p role="alert">お問い合わせを読み込めませんでした。再読み込みしてください。</p>
      <button type="button" className="primary-button" onClick={() => window.location.reload()}>再読み込み</button>
    </section> : this.props.children;
  }
}

// Keep navigation and its focus target mounted while optional contact code loads.
export function ContactPage({ authSession }: { authSession?: AuthSessionService } = {}) {
  return <main className="legal-page-shell"><article className="legal-page-card">
    <PublicPageLink className="legal-back-link" href="/">Laplanceへ戻る</PublicPageLink>
    <header className="legal-page-header"><p className="eyebrow">Laplance</p><h1>お問い合わせ</h1></header>
    <ContactContentBoundary>
      <Suspense fallback={<p role="status" aria-label="お問い合わせを読み込み中"><LoaderCircle size={20} aria-hidden="true" /></p>}>
        <ContactPageContent authSession={authSession} />
      </Suspense>
    </ContactContentBoundary>
  </article></main>;
}
