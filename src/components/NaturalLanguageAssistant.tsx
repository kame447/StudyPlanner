import { useState } from 'react';
import { sortByDateTime } from '../lib/date';
import { PlanFieldsEditor } from './PlanFieldsEditor';
import {
  generateNaturalLanguageSuggestions,
  getPlannerAiRuntimeInfo,
} from '../services/naturalLanguagePlanner';
import type {
  AiInputMode,
  WeeklyPlanDraftBlock,
} from '../features/weeklyPlanning/types';
import {
  createFallbackWeeklyDraftBlock,
  createWeeklyDraftBlockFromPlanDraft,
} from '../features/weeklyPlanning/weeklyPlanningTransforms';
import type {
  NaturalLanguageMode,
  NaturalLanguageSuggestion,
  Plan,
  PlanDraft,
  SuggestionField,
  StudyMaterial,
  StudySubject,
} from '../types/domain';

interface NaturalLanguageAssistantProps {
  selectedDate: string;
  userId: string;
  plans: Plan[];
  materials?: StudyMaterial[];
  subjects?: StudySubject[];
  onApplyDraft: (draft: PlanDraft, targetPlanId?: string) => Promise<void>;
  weeklyDraftBlocks?: WeeklyPlanDraftBlock[];
  onCreateWeeklyDraftBlocks?: (blocks: WeeklyPlanDraftBlock[]) => void;
  onRemoveWeeklyDraftBlock?: (blockId: string) => void;
  onClearWeeklyDraftBlocks?: () => void;
  onApproveWeeklyDraftBlocks?: () => Promise<void>;
  embedded?: boolean;
}

const FIELD_LABELS: Record<SuggestionField, string> = {
  targetPlan: '修正対象',
  date: '日付',
  startTime: '開始時刻',
  endTime: '終了時刻',
  subject: '科目',
  type: '種別',
  title: '予定名',
  memo: 'メモ',
};

const STATUS_LABELS = {
  ready: '反映可',
  needs_review: '要確認',
  failed: '反映不可',
} as const;

const ISSUE_LABELS: Record<string, string> = {
  ai_unavailable: 'AIに接続できませんでした',
  model_output_unusable: 'モデル出力が不安定で採用できませんでした',
  date_format_invalid: '日付の形式が不正です',
  date_hallucinated: '入力文にない日付が出力されました',
  start_time_invalid: '開始時刻の形式が不正です',
  end_time_invalid: '終了時刻の形式が不正です',
  time_reversed: '終了時刻が開始時刻より前になっています',
  time_overlap_conflict: '前の予定と5分以上重なっています',
  start_time_conflicts_with_input: '開始時刻が入力文と矛盾しています',
  end_time_conflicts_with_input: '終了時刻が入力文と矛盾しています',
  title_not_grounded: '予定名に入力文にない内容が含まれています',
  memo_not_grounded: 'メモに入力文にない内容が含まれています',
  subject_not_grounded: '科目推定が入力文と一致していません',
};

function canApplySuggestion(
  suggestion: NaturalLanguageSuggestion,
  targetPlanId = '',
): boolean {
  return (
    suggestion.status !== 'failed' &&
    suggestion.parsedPlan.title.trim().length > 0 &&
    suggestion.parsedPlan.date.trim().length > 0 &&
    suggestion.parsedPlan.startTime.trim().length > 0 &&
    suggestion.parsedPlan.endTime.trim().length > 0 &&
    (suggestion.mode !== 'edit' || targetPlanId.trim().length > 0)
  );
}

export function NaturalLanguageAssistant({
  selectedDate,
  userId,
  plans,
  materials = [],
  subjects = [],
  onApplyDraft,
  weeklyDraftBlocks = [],
  onCreateWeeklyDraftBlocks,
  onRemoveWeeklyDraftBlock,
  onClearWeeklyDraftBlocks,
  onApproveWeeklyDraftBlocks,
  embedded = false,
}: NaturalLanguageAssistantProps) {
  const [aiInputMode, setAiInputMode] = useState<AiInputMode>('chat');
  const [mode, setMode] = useState<NaturalLanguageMode>('add');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [suggestions, setSuggestions] = useState<NaturalLanguageSuggestion[]>([]);
  const [editTargetPlanId, setEditTargetPlanId] = useState('');
  const runtimeInfo = getPlannerAiRuntimeInfo();

  const nearbyPlans = plans.filter((plan) => {
    const deltaDays =
      Math.abs(
        new Date(`${plan.date}T00:00:00`).getTime() -
          new Date(`${selectedDate}T00:00:00`).getTime(),
      ) /
      (1000 * 60 * 60 * 24);

    return deltaDays <= 7;
  });
  const candidatePlans = sortByDateTime(nearbyPlans.length > 0 ? nearbyPlans : plans);
  const applyableAddSuggestions = suggestions.filter((suggestion) =>
    canApplySuggestion(suggestion),
  );
  const pendingWeeklyDraftBlocks = weeklyDraftBlocks.filter(
    (block) => block.status === 'draft',
  );
  const canCreateWeeklyDraft = text.trim().length > 0;

  async function handleAnalyze() {
    if (!text.trim()) {
      setError('自然言語の入力内容を入れてください。');
      return;
    }

    setIsAnalyzing(true);

    try {
      const nextSuggestions = await generateNaturalLanguageSuggestions({
        mode,
        text,
        selectedDate,
        plans,
        userId,
        userMaterials: materials,
        userSubjects: subjects,
      });

      setError('');
      setStatus(
        mode === 'add'
          ? `${nextSuggestions.length}件の叩き台を作りました。`
          : '叩き台を作りました。',
      );
      setSuggestions(nextSuggestions);
      setEditTargetPlanId(nextSuggestions[0]?.matchedPlanId ?? '');
    } catch {
      setError('提案の生成に失敗しました。');
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleCreateWeeklyDrafts() {
    if (!onCreateWeeklyDraftBlocks) {
      setError('週間計画の仮予定を作成する準備ができていません。');
      return;
    }

    if (!text.trim()) {
      setError('週間計画にしたい内容を入力してください。');
      return;
    }

    setIsAnalyzing(true);

    try {
      const nextSuggestions = await generateNaturalLanguageSuggestions({
        mode: 'add',
        text,
        selectedDate,
        plans,
        userId,
        userMaterials: materials,
        userSubjects: subjects,
      });
      const nextBlocks = nextSuggestions
        .filter((suggestion) => canApplySuggestion(suggestion))
        .map((suggestion) =>
          createWeeklyDraftBlockFromPlanDraft(suggestion.parsedPlan),
        );

      if (nextBlocks.length === 0) {
        nextBlocks.push(
          createFallbackWeeklyDraftBlock({
            userId,
            selectedDate,
            text,
          }),
        );
      }

      onCreateWeeklyDraftBlocks(nextBlocks);
      setError('');
      setStatus(
        `${nextBlocks.length}件の週間計画ドラフトを作りました。承認するまで保存されません。`,
      );
      setText('');
    } catch {
      const fallbackBlock = createFallbackWeeklyDraftBlock({
        userId,
        selectedDate,
        text,
      });
      onCreateWeeklyDraftBlocks([fallbackBlock]);
      setError('');
      setStatus('簡易ドラフトを1件作りました。承認するまで保存されません。');
      setText('');
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleApproveWeeklyDrafts() {
    if (!onApproveWeeklyDraftBlocks || pendingWeeklyDraftBlocks.length === 0) {
      return;
    }

    setIsAnalyzing(true);
    try {
      await onApproveWeeklyDraftBlocks();
      setError('');
      setStatus(`${pendingWeeklyDraftBlocks.length}件の仮予定を通常予定として保存しました。`);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : '仮予定の承認に失敗しました。',
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  function updateSuggestionAt(index: number, nextSuggestion: NaturalLanguageSuggestion) {
    setSuggestions((current) =>
      current.map((suggestion, suggestionIndex) =>
        suggestionIndex === index ? nextSuggestion : suggestion,
      ),
    );
  }

  function removeSuggestionAt(index: number) {
    setSuggestions((current) =>
      current.filter((_, suggestionIndex) => suggestionIndex !== index),
    );
  }

  async function handleApplySingle(index: number) {
    const suggestion = suggestions[index];

    if (!suggestion) {
      return;
    }

    if (suggestion.mode === 'edit' && !editTargetPlanId) {
      setError('修正対象の予定を選んでください。');
      return;
    }

    setError('');
    try {
      await onApplyDraft(
        suggestion.parsedPlan,
        suggestion.mode === 'edit' ? editTargetPlanId : undefined,
      );
      setStatus(
        suggestion.mode === 'edit'
          ? '修正案を反映しました。'
          : '学習予定を1件追加しました。',
      );
      removeSuggestionAt(index);

      if (suggestion.mode === 'edit') {
        setText('');
        setSuggestions([]);
        setEditTargetPlanId('');
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : '学習予定の反映に失敗しました。',
      );
    }
  }

  async function handleApplyAll() {
    if (mode !== 'add') {
      return;
    }

    const validSuggestions = suggestions.filter((suggestion) =>
      canApplySuggestion(suggestion),
    );

    if (validSuggestions.length === 0) {
      setError('反映できる提案がありません。');
      return;
    }

    try {
      for (const suggestion of validSuggestions) {
        await onApplyDraft(suggestion.parsedPlan);
      }

      const remainingSuggestions = suggestions.filter(
        (suggestion) => !canApplySuggestion(suggestion),
      );
      setSuggestions(remainingSuggestions);
      setStatus(
        remainingSuggestions.length === 0
          ? `${validSuggestions.length}件の学習予定を追加しました。`
          : `${validSuggestions.length}件の学習予定を追加し、${remainingSuggestions.length}件は未反映のまま残しました。`,
      );

      if (remainingSuggestions.length === 0) {
        setText('');
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : '学習予定の反映に失敗しました。',
      );
    }
  }

  const content = (
    <>
      <div className="section-header">
        <div>
          <h2>AI入力補助</h2>
          <p>
            相談では従来通り予定を直接追加・修正し、週間計画では未保存の仮予定として表示します。
          </p>
        </div>
        <div className="assistant-runtime">
          <span className="confidence-badge">current pipeline first</span>
          <span className="assistant-runtime-help">{runtimeInfo.fallbackLabel}</span>
        </div>
      </div>

      <div className="segmented-control">
        <button
          className={aiInputMode === 'chat' ? 'segment active' : 'segment'}
          onClick={() => {
            setAiInputMode('chat');
            setError('');
            setStatus('');
          }}
          type="button"
        >
          相談
        </button>
        <button
          className={aiInputMode === 'weekly_planning' ? 'segment active' : 'segment'}
          onClick={() => {
            setAiInputMode('weekly_planning');
            setError('');
            setStatus('');
            setSuggestions([]);
            setEditTargetPlanId('');
          }}
          type="button"
        >
          週間計画
        </button>
      </div>

      {aiInputMode === 'chat' ? (
        <>
      <div className="segmented-control">
        <button
          className={mode === 'add' ? 'segment active' : 'segment'}
          onClick={() => {
            setMode('add');
            setSuggestions([]);
            setEditTargetPlanId('');
          }}
          type="button"
        >
          追加案
        </button>
        <button
          className={mode === 'edit' ? 'segment active' : 'segment'}
          onClick={() => {
            setMode('edit');
            setSuggestions([]);
            setEditTargetPlanId('');
          }}
          type="button"
        >
          修正案
        </button>
      </div>

      <label className="field field-full">
        <span>自然言語入力</span>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={4}
          placeholder={
            mode === 'add'
              ? '例: 明日18時から20時で英語の勉強を追加'
              : '例: 数学の勉強を19時半開始に変更'
          }
        />
      </label>

      <button
        className="primary-button"
        onClick={() => void handleAnalyze()}
        type="button"
        disabled={isAnalyzing}
      >
        {isAnalyzing ? '解析中...' : '叩き台を作る'}
      </button>

      {error ? <p className="inline-error">{error}</p> : null}
      {status ? <p className="inline-note">{status}</p> : null}

      {suggestions.length > 0 ? (
        <div className="section-stack">
          {suggestions.map((suggestion, index) => (
            <div key={`${suggestion.rawText}-${index}`} className="suggestion-card">
              <div className="label-row">
                <strong>{mode === 'add' ? `AI提案 ${index + 1}` : 'AI提案'}</strong>
                <span className="confidence-badge">
                  {suggestion.source === 'llm' ? 'AI補助' : 'ルール解析'} /{' '}
                  {STATUS_LABELS[suggestion.status]} / 推定{' '}
                  {Math.round(suggestion.confidence * 100)}%
                </span>
              </div>
              <p className="detail-note">{suggestion.reason}</p>

              {suggestion.issues.length > 0 ? (
                <div className="assistant-feedback-card warning">
                  <strong>検出した問題</strong>
                  <ul className="assistant-feedback-list">
                    {suggestion.issues.map((issue) => (
                      <li key={issue}>{ISSUE_LABELS[issue] ?? issue}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {suggestion.assumptions.length > 0 ? (
                <div className="assistant-feedback-card">
                  <strong>解析の補足</strong>
                  <ul className="assistant-feedback-list">
                    {suggestion.assumptions.map((assumption) => (
                      <li key={assumption}>{assumption}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {suggestion.unresolvedFields.length > 0 ? (
                <div className="assistant-feedback-card warning">
                  <strong>未確定の項目</strong>
                  <p className="detail-note">
                    {suggestion.unresolvedFields
                      .map((field) => FIELD_LABELS[field])
                      .join(' / ')}
                  </p>
                </div>
              ) : null}

              {suggestion.mode === 'edit' ? (
                <label className="field field-full">
                  <span>修正対象</span>
                  <select
                    value={editTargetPlanId}
                    onChange={(event) => setEditTargetPlanId(event.target.value)}
                  >
                    <option value="">予定を選ぶ</option>
                    {candidatePlans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.date} {plan.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <PlanFieldsEditor
                draft={suggestion.parsedPlan}
                onChange={(draft) =>
                  updateSuggestionAt(index, {
                    ...suggestion,
                    parsedPlan: draft,
                  })
                }
              />

              <div className="row-actions">
                <button
                  className="ghost-button"
                  onClick={() =>
                    mode === 'edit' ? setSuggestions([]) : removeSuggestionAt(index)
                  }
                  type="button"
                >
                  {mode === 'edit' ? '破棄' : 'この案を除外'}
                </button>
                <button
                  className="primary-button"
                  onClick={() => void handleApplySingle(index)}
                  type="button"
                  disabled={
                    !canApplySuggestion(
                      suggestion,
                      suggestion.mode === 'edit' ? editTargetPlanId : undefined,
                    )
                  }
                >
                  {suggestion.mode === 'edit' ? '修正として反映' : 'この案だけ追加'}
                </button>
              </div>
            </div>
          ))}

          {mode === 'add' && suggestions.length > 1 ? (
            <div className="row-actions">
              <button
                className="ghost-button"
                onClick={() => setSuggestions([])}
                type="button"
              >
                全部破棄
              </button>
              <button
                className="primary-button"
                onClick={() => void handleApplyAll()}
                type="button"
                disabled={applyableAddSuggestions.length === 0}
              >
                有効な{applyableAddSuggestions.length}件の学習予定をまとめて追加
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
        </>
      ) : (
        <div className="section-stack weekly-planning-assistant">
          <label className="field field-full">
            <span>週間計画にしたいこと</span>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={4}
              placeholder="例: 来週、計算理論と英語を少しずつ進めたい"
            />
          </label>

          <div className="row-actions">
            <button
              className="primary-button"
              onClick={() => void handleCreateWeeklyDrafts()}
              type="button"
              disabled={isAnalyzing || !canCreateWeeklyDraft}
            >
              {isAnalyzing ? '作成中...' : '仮予定を作る'}
            </button>
          </div>

          {pendingWeeklyDraftBlocks.length > 0 ? (
            <div className="weekly-draft-control-card">
              <div className="label-row">
                <strong>未承認の週間計画</strong>
                <span className="confidence-badge">
                  {pendingWeeklyDraftBlocks.length}件 / 未保存
                </span>
              </div>
              <div className="weekly-draft-list">
                {pendingWeeklyDraftBlocks.map((block) => (
                  <div className="weekly-draft-list-item" key={block.id}>
                    <span>
                      <strong>{block.title}</strong>
                      <small>
                        {block.date} {block.startTime}-{block.endTime} / {block.label}
                      </small>
                    </span>
                    {onRemoveWeeklyDraftBlock ? (
                      <button
                        className="ghost-button"
                        onClick={() => onRemoveWeeklyDraftBlock(block.id)}
                        type="button"
                      >
                        削除
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="row-actions">
                {onClearWeeklyDraftBlocks ? (
                  <button
                    className="ghost-button"
                    onClick={onClearWeeklyDraftBlocks}
                    type="button"
                  >
                    一括破棄
                  </button>
                ) : null}
                {onApproveWeeklyDraftBlocks ? (
                  <button
                    className="primary-button"
                    onClick={() => void handleApproveWeeklyDrafts()}
                    type="button"
                    disabled={isAnalyzing}
                  >
                    一括承認して保存
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="assistant-feedback-card">
              <strong>週間計画MVP</strong>
              <p className="detail-note">
                ここで作る仮予定は、承認するまで通常予定として保存されません。
              </p>
            </div>
          )}
        </div>
      )}
    </>
  );

  if (embedded) {
    return <div className="section-stack">{content}</div>;
  }

  return <section className="panel section-stack">{content}</section>;
}
