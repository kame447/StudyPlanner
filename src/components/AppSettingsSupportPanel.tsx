import { PublicPageLink } from './PublicPageLink';
import {
  ChevronRight,
  FileText,
  Info,
  Presentation,
  MessageSquare,
  ShieldCheck,
  UserX,
} from 'lucide-react';
import { FaqView } from './FaqView';

export function AppSettingsSupportPanel({ onShowTutorial, onDeleteAccount }: { onShowTutorial?: () => void; onDeleteAccount?: () => void } = {}) {
  return (
    <div className="section-stack">
      <FaqView />

      <section className="assistant-settings-card support-section">
        <strong>ヘルプ</strong>
        {onShowTutorial ? <button type="button" className="support-link-row support-tour-link" onClick={onShowTutorial}>
          <span className="support-link-main"><Presentation aria-hidden="true" size={20} strokeWidth={1.9} /><span>使い方を見る</span></span>
          <ChevronRight aria-hidden="true" size={20} strokeWidth={1.9} />
        </button> : null}
        <PublicPageLink className="support-link-row" href="/contact">
          <span className="support-link-main">
            <MessageSquare aria-hidden="true" size={20} strokeWidth={1.9} />
            <span>お問い合わせ</span>
          </span>
          <ChevronRight aria-hidden="true" size={20} strokeWidth={1.9} />
        </PublicPageLink>
        {onDeleteAccount ? (
          <button className="support-link-row support-link-button" type="button" onClick={onDeleteAccount}>
            <span className="support-link-main">
              <UserX aria-hidden="true" size={20} strokeWidth={1.9} />
              <span>退会する</span>
            </span>
            <ChevronRight aria-hidden="true" size={20} strokeWidth={1.9} />
          </button>
        ) : null}
      </section>

      <section className="assistant-settings-card support-section">
        <strong>サービスについて</strong>
        <PublicPageLink className="support-link-row" href="/terms">
          <span className="support-link-main">
            <FileText aria-hidden="true" size={20} strokeWidth={1.9} />
            <span>利用規約</span>
          </span>
          <ChevronRight aria-hidden="true" size={20} strokeWidth={1.9} />
        </PublicPageLink>
        <PublicPageLink className="support-link-row" href="/privacy">
          <span className="support-link-main">
            <ShieldCheck aria-hidden="true" size={20} strokeWidth={1.9} />
            <span>プライバシーポリシー</span>
          </span>
          <ChevronRight aria-hidden="true" size={20} strokeWidth={1.9} />
        </PublicPageLink>
        <div className="support-link-row support-link-row-static">
          <span className="support-link-main">
            <Info aria-hidden="true" size={20} strokeWidth={1.9} />
            <span>バージョン情報</span>
          </span>
          <strong>Laplance 0.1.0</strong>
        </div>
        <p className="support-copyright">© 2026 Laplance</p>
      </section>
    </div>
  );
}
