import {
  ChevronRight,
  FileText,
  Info,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import { FaqView } from './FaqView';

export function AppSettingsSupportPanel() {
  return (
    <div className="section-stack" role="tabpanel">
      <FaqView />

      <section className="assistant-settings-card support-section">
        <strong>ヘルプ</strong>
        <a className="support-link-row" href="/contact">
          <span className="support-link-main">
            <Mail aria-hidden="true" size={20} strokeWidth={1.9} />
            <span>お問い合わせ</span>
          </span>
          <ChevronRight aria-hidden="true" size={20} strokeWidth={1.9} />
        </a>
      </section>

      <section className="assistant-settings-card support-section">
        <strong>サービスについて</strong>
        <a className="support-link-row" href="/terms">
          <span className="support-link-main">
            <FileText aria-hidden="true" size={20} strokeWidth={1.9} />
            <span>利用規約</span>
          </span>
          <ChevronRight aria-hidden="true" size={20} strokeWidth={1.9} />
        </a>
        <a className="support-link-row" href="/privacy">
          <span className="support-link-main">
            <ShieldCheck aria-hidden="true" size={20} strokeWidth={1.9} />
            <span>プライバシーポリシー</span>
          </span>
          <ChevronRight aria-hidden="true" size={20} strokeWidth={1.9} />
        </a>
        <div className="support-link-row support-link-row-static">
          <span className="support-link-main">
            <Info aria-hidden="true" size={20} strokeWidth={1.9} />
            <span>バージョン情報</span>
          </span>
          <strong>StudyPlanner 0.1.0</strong>
        </div>
        <p className="support-copyright">© 2026 StudyPlanner</p>
      </section>
    </div>
  );
}
