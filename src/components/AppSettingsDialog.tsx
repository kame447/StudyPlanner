import { useEffect, useMemo, useState } from 'react';
import {
  Brain,
  CalendarDays,
  Palette,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  SunMoon,
  Trash2,
} from 'lucide-react';
import { useOptionalUserPlanningContextV1 } from '../features/userPlanningContext/UserPlanningContextContext';
import { userPlanningContextDisplayTextV1 } from '../features/userPlanningContext/userPlanningContextSpace';
import type { UserPlanningContextRecordV1 } from '../features/userPlanningContext/userPlanningContextTypes';
import { useWeeklyPlanningPersonalization } from '../features/weeklyPlanning/personalization/WeeklyPlanningPersonalizationContext';
import {
  THEME_PALETTE_OPTIONS,
  type ThemeMode,
  type ThemePalette,
} from '../lib/themePalette';
import { AppSettingsSupportPanel } from './AppSettingsSupportPanel';

type AppSettingsTab = 'settings' | 'memory' | 'support';

interface AppSettingsDialogProps {
  open: boolean;
  themeMode: ThemeMode;
  themePalette: ThemePalette;
  onChangeTheme: (nextThemeMode: ThemeMode) => void;
  onChangeThemePalette: (nextThemePalette: ThemePalette) => void;
  onClose: () => void;
}

function memoryOriginLabel(record: UserPlanningContextRecordV1): string {
  if (record.origin === 'user_confirmed') return '自分で確認';
  if (record.origin === 'migration') return '既存データ';
  if (record.origin === 'system_inferred') return 'AIの推定';
  return '会話から記憶';
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
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [editorText, setEditorText] = useState('');
  const [editorError, setEditorError] = useState<string | null>(null);
  const memory = useOptionalUserPlanningContextV1();
  const {
    weekStartsOn,
    setWeekStartsOn,
    resetProfile: resetWeeklyPlanningPersonalization,
  } = useWeeklyPlanningPersonalization();
  const selectedThemePalette =
    THEME_PALETTE_OPTIONS.find((palette) => palette.id === themePalette) ??
    THEME_PALETTE_OPTIONS[0];

  const memoryRecords = useMemo(
    () => memory?.records.slice().sort((left, right) => right.recordedAt.localeCompare(left.recordedAt)) ?? [],
    [memory?.records],
  );

  const resetEditor = () => {
    setEditorOpen(false);
    setEditingRecordId(null);
    setEditorText('');
    setEditorError(null);
  };

  const openNewMemory = () => {
    resetEditor();
    setEditorOpen(true);
  };

  const openExistingMemory = (record: UserPlanningContextRecordV1) => {
    setEditorOpen(true);
    setEditingRecordId(record.id);
    setEditorText(userPlanningContextDisplayTextV1(record));
    setEditorError(null);
  };

  useEffect(() => {
    if (!open) return;
    setActiveTab('settings');
    setIsThemePaletteSectionOpen(false);
    resetEditor();
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
              <p>表示、AIが覚えていること、サポート情報を管理できます。</p>
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
              className={activeTab === 'memory' ? 'segment active' : 'segment'}
              onClick={() => setActiveTab('memory')}
              role="tab"
              aria-selected={activeTab === 'memory'}
              type="button"
            >
              AIの記憶
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
          ) : activeTab === 'memory' ? (
            <div className="section-stack memory-settings-panel" role="tabpanel">
              <section className="assistant-settings-card memory-settings-intro">
                <div>
                  <span className="settings-field-label">
                    <Brain aria-hidden="true" size={20} strokeWidth={1.9} />
                    AIが覚えていること
                  </span>
                  <p className="detail-note">
                    別の計画でも役立つ目標、苦手、学習方法の好みなどを確認できます。教材の進捗、時間割、予定、実績はそれぞれの機能を正本として扱います。
                  </p>
                </div>
                <div className="memory-sync-row">
                  <span className={memory?.shared ? 'confidence-badge' : 'confidence-badge muted'}>
                    {memory?.shared ? '端末間で共有' : '共有未接続'}
                  </span>
                  {memory?.syncing ? <span className="detail-note">整理・同期中…</span> : null}
                </div>
                {memory?.error ? <p className="settings-inline-error">{memory.error}</p> : null}
              </section>

              {memory ? (
                <>
                  <div className="memory-settings-toolbar">
                    <strong>覚えていること</strong>
                    <button className="ghost-button" onClick={openNewMemory} type="button" disabled={memory.syncing}>
                      <Plus aria-hidden="true" size={18} strokeWidth={1.9} />
                      追加
                    </button>
                  </div>

                  {editorOpen ? (
                    <section className="assistant-settings-card memory-editor-card">
                      <label className="memory-editor-field">
                        <span>{editingRecordId ? '内容を直す' : '覚えておいてほしいこと'}</span>
                        <textarea
                          value={editorText}
                          onChange={(event) => setEditorText(event.target.value)}
                          placeholder="例：英単語は15分くらいに分けて勉強したい"
                          rows={3}
                          disabled={memory.syncing}
                        />
                      </label>
                      <p className="detail-note">
                        種類を選ぶ必要はありません。AIが意味を整理し、保存先はStudyPlanner側で判断します。
                      </p>
                      {editorError ? <p className="settings-inline-error">{editorError}</p> : null}
                      <div className="memory-editor-actions">
                        <button className="ghost-button" onClick={resetEditor} type="button" disabled={memory.syncing}>
                          キャンセル
                        </button>
                        <button
                          className="primary-button"
                          type="button"
                          disabled={memory.syncing || !editorText.trim()}
                          onClick={() => {
                            setEditorError(null);
                            void memory.saveNaturalLanguage({
                              existingRecordId: editingRecordId,
                              text: editorText,
                            }).then(resetEditor).catch((saveError: unknown) => {
                              setEditorError(saveError instanceof Error ? saveError.message : '保存できませんでした。');
                            });
                          }}
                        >
                          {editingRecordId ? '更新' : '覚えておく'}
                        </button>
                      </div>
                    </section>
                  ) : null}

                  {memoryRecords.length === 0 ? (
                    <section className="assistant-settings-card memory-empty-state">
                      <Brain aria-hidden="true" size={24} strokeWidth={1.7} />
                      <strong>まだ覚えていることはありません</strong>
                      <p className="detail-note">AI計画の会話から必要な情報を覚えるか、ここから自然な文章で追加できます。</p>
                    </section>
                  ) : (
                    <div className="memory-record-list">
                      {memoryRecords.map((record) => {
                        const displayText = userPlanningContextDisplayTextV1(record);
                        return (
                          <article className="assistant-settings-card memory-record-card" key={record.id}>
                            <div className="memory-record-main">
                              <div className="memory-record-meta">
                                <span className="confidence-badge muted">{memoryOriginLabel(record)}</span>
                                {record.status === 'needs_review' ? (
                                  <span className="confidence-badge muted">要確認</span>
                                ) : null}
                                {record.status === 'historical' ? (
                                  <span className="confidence-badge muted">過去</span>
                                ) : null}
                              </div>
                              <p className="memory-record-text">{displayText}</p>
                            </div>
                            <div className="memory-record-actions">
                              <button
                                className="icon-button"
                                aria-label="この内容を編集"
                                onClick={() => openExistingMemory(record)}
                                type="button"
                                disabled={memory.syncing}
                              >
                                <Pencil aria-hidden="true" size={17} strokeWidth={1.9} />
                              </button>
                              <button
                                className="icon-button danger"
                                aria-label="この内容を忘れる"
                                onClick={() => {
                                  if (!window.confirm(`「${displayText}」を忘れますか？`)) return;
                                  void memory.removeRecord(record.id).catch(() => undefined);
                                }}
                                type="button"
                                disabled={memory.syncing}
                              >
                                <Trash2 aria-hidden="true" size={17} strokeWidth={1.9} />
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <section className="assistant-settings-card memory-empty-state">
                  <strong>AIが覚えている情報を利用できません</strong>
                  <p className="detail-note">ログイン済みの通常画面から設定を開いてください。</p>
                </section>
              )}
            </div>
          ) : (
            <AppSettingsSupportPanel />
          )}
        </div>
      </div>
    </div>
  );
}
