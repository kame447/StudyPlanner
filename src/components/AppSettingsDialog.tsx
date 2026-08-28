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
import {
  useOptionalUserPlanningContextV1,
  userPlanningContextDateTextV1,
} from '../features/userPlanningContext/UserPlanningContextContext';
import type {
  UserPlanningContextRecordV1,
  UserPlanningContextSemanticKindV1,
} from '../features/userPlanningContext/userPlanningContextTypes';
import { useWeeklyPlanningPersonalization } from '../features/weeklyPlanning/personalization/WeeklyPlanningPersonalizationContext';
import {
  THEME_PALETTE_OPTIONS,
  type ThemeMode,
  type ThemePalette,
} from '../lib/themePalette';
import { AppSettingsSupportPanel } from './AppSettingsSupportPanel';

type AppSettingsTab = 'settings' | 'memory' | 'support';

const MEMORY_KIND_OPTIONS: Array<{
  kind: UserPlanningContextSemanticKindV1;
  label: string;
  description: string;
}> = [
  { kind: 'study_goal', label: '学習・進学目標', description: '第一志望、資格取得など' },
  { kind: 'goal_event', label: '試験・期限', description: '受験日、試験時期など' },
  { kind: 'concern', label: '苦手・不安', description: '継続的に考慮したい苦手分野など' },
  { kind: 'learning_preference', label: '学習の好み', description: '長期的に使う学習方法の好み' },
];

interface AppSettingsDialogProps {
  open: boolean;
  themeMode: ThemeMode;
  themePalette: ThemePalette;
  onChangeTheme: (nextThemeMode: ThemeMode) => void;
  onChangeThemePalette: (nextThemePalette: ThemePalette) => void;
  onClose: () => void;
}

function memoryKindLabel(kind: UserPlanningContextSemanticKindV1): string {
  return MEMORY_KIND_OPTIONS.find((option) => option.kind === kind)?.label ?? kind;
}

function memoryValue(record: UserPlanningContextRecordV1): string {
  if (record.kind === 'goal_event') {
    const date = userPlanningContextDateTextV1(record);
    return [record.value, date].filter(Boolean).join(' · ') || '時期未設定';
  }
  return record.value || '内容未設定';
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
  const [editorKind, setEditorKind] = useState<UserPlanningContextSemanticKindV1>('study_goal');
  const [editorLabel, setEditorLabel] = useState('');
  const [editorValue, setEditorValue] = useState('');
  const [editorDate, setEditorDate] = useState('');
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
    setEditorKind('study_goal');
    setEditorLabel('');
    setEditorValue('');
    setEditorDate('');
    setEditorError(null);
  };

  const openNewMemory = () => {
    resetEditor();
    setEditorOpen(true);
  };

  const openExistingMemory = (record: UserPlanningContextRecordV1) => {
    setEditorOpen(true);
    setEditingRecordId(record.id);
    setEditorKind(record.kind);
    setEditorLabel(record.label);
    setEditorValue(record.value ?? '');
    setEditorDate(userPlanningContextDateTextV1(record));
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
              <p>表示、長期記憶、サポート情報を管理できます。</p>
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
              長期記憶
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
                    AIが今後も覚えておく情報
                  </span>
                  <p className="detail-note">
                    第一志望、受験時期、継続的な苦手など、別の計画でも使う情報です。ここで直した内容はAIの推測より優先されます。
                  </p>
                </div>
                <div className="memory-sync-row">
                  <span className={memory?.shared ? 'confidence-badge' : 'confidence-badge muted'}>
                    {memory?.shared ? '端末間で共有' : '共有未接続'}
                  </span>
                  {memory?.syncing ? <span className="detail-note">同期中…</span> : null}
                </div>
                {memory?.error ? <p className="settings-inline-error">{memory.error}</p> : null}
              </section>

              {memory ? (
                <>
                  <div className="memory-settings-toolbar">
                    <strong>保存されている長期記憶</strong>
                    <button className="ghost-button" onClick={openNewMemory} type="button" disabled={memory.syncing}>
                      <Plus aria-hidden="true" size={18} strokeWidth={1.9} />
                      追加
                    </button>
                  </div>

                  {editorOpen ? (
                    <section className="assistant-settings-card memory-editor-card">
                      <label className="memory-editor-field">
                        <span>種類</span>
                        <select
                          value={editorKind}
                          onChange={(event) => setEditorKind(event.target.value as UserPlanningContextSemanticKindV1)}
                          disabled={memory.syncing}
                        >
                          {MEMORY_KIND_OPTIONS.map((option) => (
                            <option key={option.kind} value={option.kind}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="memory-editor-field">
                        <span>項目名</span>
                        <input
                          value={editorLabel}
                          onChange={(event) => setEditorLabel(event.target.value)}
                          placeholder={editorKind === 'study_goal' ? '例：第一志望' : '例：数学'}
                          disabled={memory.syncing}
                        />
                      </label>
                      <label className="memory-editor-field">
                        <span>内容</span>
                        <input
                          value={editorValue}
                          onChange={(event) => setEditorValue(event.target.value)}
                          placeholder={editorKind === 'study_goal' ? '例：静岡大学 情報学部' : '覚えておく内容'}
                          disabled={memory.syncing}
                        />
                      </label>
                      {editorKind === 'goal_event' ? (
                        <label className="memory-editor-field">
                          <span>時期</span>
                          <input
                            value={editorDate}
                            onChange={(event) => setEditorDate(event.target.value)}
                            placeholder="例：2027年1月 / 2027-01-16"
                            disabled={memory.syncing}
                          />
                        </label>
                      ) : null}
                      {editorError ? <p className="settings-inline-error">{editorError}</p> : null}
                      <div className="memory-editor-actions">
                        <button className="ghost-button" onClick={resetEditor} type="button" disabled={memory.syncing}>
                          キャンセル
                        </button>
                        <button
                          className="primary-button"
                          type="button"
                          disabled={memory.syncing || !editorLabel.trim()}
                          onClick={() => {
                            setEditorError(null);
                            void memory.saveRecord({
                              existingRecordId: editingRecordId,
                              kind: editorKind,
                              label: editorLabel,
                              value: editorValue,
                              dateText: editorDate,
                            }).then(resetEditor).catch((saveError: unknown) => {
                              setEditorError(saveError instanceof Error ? saveError.message : '保存できませんでした。');
                            });
                          }}
                        >
                          保存
                        </button>
                      </div>
                    </section>
                  ) : null}

                  {memoryRecords.length === 0 ? (
                    <section className="assistant-settings-card memory-empty-state">
                      <Brain aria-hidden="true" size={24} strokeWidth={1.7} />
                      <strong>まだ長期記憶はありません</strong>
                      <p className="detail-note">AI計画の会話から重要な情報を覚えるか、ここから追加できます。</p>
                    </section>
                  ) : (
                    <div className="memory-record-list">
                      {memoryRecords.map((record) => (
                        <article className="assistant-settings-card memory-record-card" key={record.id}>
                          <div className="memory-record-main">
                            <div className="memory-record-meta">
                              <span>{memoryKindLabel(record.kind)}</span>
                              <span className="confidence-badge muted">
                                {record.origin === 'user_confirmed'
                                  ? 'ユーザー確認済み'
                                  : record.origin === 'migration'
                                    ? '既存データ'
                                    : 'AIが会話から記憶'}
                              </span>
                              {record.status === 'historical' ? <span className="confidence-badge muted">過去</span> : null}
                            </div>
                            <strong>{record.label}</strong>
                            <p>{memoryValue(record)}</p>
                          </div>
                          <div className="memory-record-actions">
                            <button
                              className="icon-button"
                              aria-label={`${record.label}を編集`}
                              onClick={() => openExistingMemory(record)}
                              type="button"
                              disabled={memory.syncing}
                            >
                              <Pencil aria-hidden="true" size={17} strokeWidth={1.9} />
                            </button>
                            <button
                              className="icon-button danger"
                              aria-label={`${record.label}を削除`}
                              onClick={() => {
                                if (!window.confirm(`「${record.label}」を長期記憶から削除しますか？`)) return;
                                void memory.removeRecord(record.id).catch(() => undefined);
                              }}
                              type="button"
                              disabled={memory.syncing}
                            >
                              <Trash2 aria-hidden="true" size={17} strokeWidth={1.9} />
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <section className="assistant-settings-card memory-empty-state">
                  <strong>共有長期記憶を利用できません</strong>
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
