import { useEffect, useState } from 'react';
import {
  ChevronRight,
  FileText,
  Info,
  Mail,
  Palette,
  ShieldCheck,
  SunMoon,
} from 'lucide-react';
import {
  THEME_PALETTE_OPTIONS,
  type ThemeMode,
  type ThemePalette,
} from '../lib/themePalette';

type AppSettingsTab = 'settings' | 'support';

interface AppSettingsDialogProps {
  open: boolean;
  themeMode: ThemeMode;
  themePalette: ThemePalette;
  onChangeTheme: (nextThemeMode: ThemeMode) => void;
  onChangeThemePalette: (nextThemePalette: ThemePalette) => void;
  onClose: () => void;
}

export function AppSettingsDialog({
  open,
  themeMode,
  themePalette,
  onChangeTheme,
  onChangeThemePalette,
  onClose,
}: AppSettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<AppSettingsTab>('settings');
  const [isThemePaletteSectionOpen, setIsThemePaletteSectionOpen] = useState(false);
  const selectedThemePalette =
    THEME_PALETTE_OPTIONS.find((palette) => palette.id === themePalette) ??
    THEME_PALETTE_OPTIONS[0];

  useEffect(() => {
    if (!open) {
      return;
    }

    setActiveTab('settings');
    setIsThemePaletteSectionOpen(false);
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="overlay modal-overlay app-settings-overlay" onClick={onClose}>
      <div
        className="modal-card app-settings-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="section-stack">
          <div className="section-header">
            <div>
              <h2>アプリ設定</h2>
              <p>表示の調整やサポート情報を確認できます。</p>
            </div>
            <button className="ghost-button" onClick={onClose} type="button">
              閉じる
            </button>
          </div>

          <div className="app-settings-tabs" role="tablist" aria-label="アプリ設定">
            <button
              className={activeTab === 'settings' ? 'segment active' : 'segment'}
              onClick={() => setActiveTab('settings')}
              role="tab"
              aria-selected={activeTab === 'settings'}
              type="button"
            >
              設定
            </button>
            <button
              className={activeTab === 'support' ? 'segment active' : 'segment'}
              onClick={() => setActiveTab('support')}
              role="tab"
              aria-selected={activeTab === 'support'}
              type="button"
            >
              サポート
            </button>
          </div>

          {activeTab === 'settings' ? (
            <div className="section-stack" role="tabpanel">
              <section className="assistant-settings-card">
                <div className="field">
                  <span className="settings-field-label">
                    <SunMoon aria-hidden="true" size={20} strokeWidth={1.9} />
                    表示モード
                  </span>
                  <div className="segmented-control">
                    <button
                      className={themeMode === 'light' ? 'segment active' : 'segment'}
                      onClick={() => onChangeTheme('light')}
                      type="button"
                    >
                      ライト
                    </button>
                    <button
                      className={themeMode === 'dark' ? 'segment active' : 'segment'}
                      onClick={() => onChangeTheme('dark')}
                      type="button"
                    >
                      ダーク
                    </button>
                  </div>
                </div>

                <div className="field collapsible-field">
                  <button
                    className="collapsible-toggle"
                    onClick={() => setIsThemePaletteSectionOpen((current) => !current)}
                    type="button"
                  >
                    <span className="collapsible-toggle-copy">
                      <span className="settings-field-label">
                        <Palette aria-hidden="true" size={20} strokeWidth={1.9} />
                        配色
                      </span>
                      <strong>{selectedThemePalette.label}</strong>
                    </span>
                    <span className="collapsible-toggle-summary" aria-hidden="true">
                      {isThemePaletteSectionOpen ? '閉じる' : '変更'}
                    </span>
                  </button>

                  {isThemePaletteSectionOpen ? (
                    <div className="collapsible-panel">
                      <div className="theme-palette-grid">
                        {THEME_PALETTE_OPTIONS.map((palette) => (
                          <button
                            key={palette.id}
                            className={
                              themePalette === palette.id
                                ? 'theme-palette-button active'
                                : 'theme-palette-button'
                            }
                            onClick={() => onChangeThemePalette(palette.id)}
                            type="button"
                          >
                            <span className="theme-palette-swatches" aria-hidden="true">
                              {palette.swatches.map((swatchColor) => (
                                <span
                                  key={swatchColor}
                                  className="theme-palette-swatch"
                                  style={{ backgroundColor: swatchColor }}
                                />
                              ))}
                            </span>
                            <span className="theme-palette-copy">
                              <strong>{palette.label}</strong>
                              <span>{palette.description}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                      <p className="detail-note">
                        配色はこの端末ですぐ反映されます。
                      </p>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="assistant-settings-card app-settings-placeholder">
                <strong>その他</strong>
                <p className="detail-note">
                  通知やカレンダー連携など、今後の設定項目をここに追加できます。
                </p>
              </section>
            </div>
          ) : (
            <div className="section-stack" role="tabpanel">
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
          )}
        </div>
      </div>
    </div>
  );
}
