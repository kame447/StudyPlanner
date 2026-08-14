import { useEffect, useState } from 'react';
import {
  CalendarDays,
  Palette,
  RotateCcw,
  Sparkles,
  SunMoon,
} from 'lucide-react';
import { useWeeklyPlanningPersonalization } from '../features/weeklyPlanning/personalization/WeeklyPlanningPersonalizationContext';
import {
  THEME_PALETTE_OPTIONS,
  type ThemeMode,
  type ThemePalette,
} from '../lib/themePalette';
import { AppSettingsSupportPanel } from './AppSettingsSupportPanel';

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
  const {
    weekStartsOn,
    setWeekStartsOn,
    resetProfile: resetWeeklyPlanningPersonalization,
  } = useWeeklyPlanningPersonalization();
  const selectedThemePalette =
    THEME_PALETTE_OPTIONS.find((palette) => palette.id === themePalette) ??
    THEME_PALETTE_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    setActiveTab('settings');
    setIsThemePaletteSectionOpen(false);
  }, [open]);

  if (!open) return null;

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

              <section className="assistant-settings-card">
                <div className="field">
                  <span className="settings-field-label">
                    <CalendarDays aria-hidden="true" size={20} strokeWidth={1.9} />
                    週の始まり
                  </span>
                  <div className="segmented-control">
                    <button
                      className={weekStartsOn === 'monday' ? 'segment active' : 'segment'}
                      onClick={() => void setWeekStartsOn('monday')}
                      type="button"
                    >
                      月曜日
                    </button>
                    <button
                      className={weekStartsOn === 'sunday' ? 'segment active' : 'segment'}
                      onClick={() => void setWeekStartsOn('sunday')}
                      type="button"
                    >
                      日曜日
                    </button>
                  </div>
                  <p className="detail-note">
                    「今週」「来週」の解釈と週間計画の保存単位に反映されます。
                  </p>
                </div>
                <button
                  className="ghost-button"
                  onClick={() => {
                    if (window.confirm('学習設定を初期化しますか？')) {
                      void resetWeeklyPlanningPersonalization();
                    }
                  }}
                  type="button"
                >
                  <RotateCcw aria-hidden="true" size={18} strokeWidth={1.9} />
                  学習設定を初期化
                </button>
              </section>

              <section className="assistant-settings-card">
                <div className="field">
                  <span className="settings-field-label">
                    <Sparkles aria-hidden="true" size={20} strokeWidth={1.9} />
                    週間計画AI
                  </span>
                  <div className="label-row">
                    <strong>Stable V5</strong>
                    <span className="confidence-badge">固定</span>
                  </div>
                  <p className="detail-note">
                    週間計画はStable V5経路だけを使用します。
                  </p>
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
            <AppSettingsSupportPanel />
          )}
        </div>
      </div>
    </div>
  );
}
