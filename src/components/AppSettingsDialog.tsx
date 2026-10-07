import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, Brain, CircleHelp, Pencil, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useOptionalUserPlanningContextV1 } from '../features/userPlanningContext/UserPlanningContextContext';
import { userPlanningContextDisplayTextV1 } from '../features/userPlanningContext/userPlanningContextSpace';
import type { UserPlanningContextRecordV1 } from '../features/userPlanningContext/userPlanningContextTypes';
import { AppSettingsSupportPanel } from './AppSettingsSupportPanel';
import { AppSettingsGeneral, type AppSettingsGeneralProps } from './AppSettingsGeneral';
import '../styles/app-settings-page.css';

type AppSettingsTab = 'settings' | 'memory' | 'support';
const TABS = [
  { id: 'settings', label: '設定', Icon: SlidersHorizontal },
  { id: 'memory', label: 'AIの記憶', Icon: Brain },
  { id: 'support', label: 'サポート', Icon: CircleHelp },
] as const;

interface AppSettingsDialogProps extends AppSettingsGeneralProps {
  open: boolean;
  onClose: () => void;
}

function memoryOriginLabel(record: UserPlanningContextRecordV1): string {
  if (record.origin === 'user_confirmed') return '自分で確認';
  if (record.origin === 'migration') return '既存データ';
  if (record.origin === 'system_inferred') return 'AIの推定';
  return '会話から記憶';
}

// The entry point is retained; settings is now a standalone page, not a modal.
export function AppSettingsDialog({ open, onClose, ...generalProps }: AppSettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<AppSettingsTab>('settings');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [editorText, setEditorText] = useState('');
  const [editorError, setEditorError] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<AppSettingsTab, HTMLButtonElement | null>>>({});
  const memory = useOptionalUserPlanningContextV1();
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
  const openNewMemory = () => { resetEditor(); setEditorOpen(true); };
  const openExistingMemory = (record: UserPlanningContextRecordV1) => {
    setEditorOpen(true);
    setEditingRecordId(record.id);
    setEditorText(userPlanningContextDisplayTextV1(record));
    setEditorError(null);
  };
  useEffect(() => {
    if (!open) return;
    setActiveTab('settings');
    resetEditor();
    titleRef.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => { if (panelRef.current) panelRef.current.scrollTop = 0; }, [activeTab, open]);

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + TABS.length - 1) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;
    event.preventDefault();
    setActiveTab(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  }

  if (!open) return null;
  return <main className="app-settings-page" aria-labelledby="app-settings-title">
    <header className="app-settings-header">
      <div className="app-settings-header-inner">
        <button className="settings-back-button" onClick={onClose} type="button">
          <ArrowLeft aria-hidden="true" size={22} /><span>戻る</span>
        </button>
        <h1 id="app-settings-title" tabIndex={-1} ref={titleRef}>アプリ設定</h1>
      </div>
    </header>
    <div className="app-settings-layout">
      <div className="app-settings-tabs" role="tablist" aria-label="アプリ設定">
        {TABS.map(({ id, label, Icon }, index) => <button key={id} type="button" role="tab"
          className="settings-tab" id={`app-settings-tab-${id}`} aria-controls="app-settings-panel"
          aria-selected={activeTab === id} tabIndex={activeTab === id ? 0 : -1}
          ref={node => { tabRefs.current[id] = node; }}
          onClick={() => setActiveTab(id)} onKeyDown={event => handleTabKey(event, index)}>
          <Icon aria-hidden="true" size={20} /><span>{label}</span>
        </button>)}
      </div>
      <div ref={panelRef} className="app-settings-content" role="tabpanel" tabIndex={0}
        id="app-settings-panel" aria-labelledby={`app-settings-tab-${activeTab}`}>
        {activeTab === 'settings' ? <AppSettingsGeneral {...generalProps} /> : activeTab === 'memory' ? (
            <div className="section-stack memory-settings-panel">
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
                {memory?.error ? <p className="settings-inline-error" role="alert">{memory.error}</p> : null}
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
                      {editorError ? <p className="settings-inline-error" role="alert">{editorError}</p> : null}
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
          ) : <AppSettingsSupportPanel />}
      </div>
    </div>
  </main>;
}
