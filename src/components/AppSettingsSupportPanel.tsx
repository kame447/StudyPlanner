import {
  ChevronRight,
  FileText,
  Info,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import { FaqView } from './FaqView';
import { startupTiming } from '../lib/startupTiming';
import { StartupTimingButton } from './StartupTimingButton';

export function AppSettingsSupportPanel() {
  return (
    <div className="section-stack">
      <section className="assistant-settings-card support-section" aria-label="起動時間の診断">
        <strong>起動時間の診断</strong>
        <p className="detail-note">このアプリを再読み込みし、起動時の待ち時間を端末内に表示します。計測結果の外部送信・保存はしません。</p>
        <StartupTimingButton enabled={startupTiming.enabled} />
      </section>

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
          <strong>Laplans 0.1.0</strong>
        </div>
        <p className="support-copyright">© 2026 Laplans</p>
      </section>
    </div>
  );
}
