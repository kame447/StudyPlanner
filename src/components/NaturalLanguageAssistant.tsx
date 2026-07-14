import { type CSSProperties, useState } from 'react';
import { getAiConfig, getAiConfigValidationMessage } from '../lib/aiConfig';
import {
  formatMinutes,
  minutesBetween,
  minutesFromTime,
  sortByDateTime,
} from '../lib/date';
import { PlanFieldsEditor } from './PlanFieldsEditor';
import {
  generateNaturalLanguageSuggestions,
  getPlannerAiRuntimeInfo,
} from '../services/naturalLanguagePlanner';
import type {
  AiInputMode,
  WeeklyPlanDraftBlock,
  WeeklyPlanningMessage,
} from '../features/weeklyPlanning/types';
import { looksLikeWeeklyPlanningRequest } from '../features/weeklyPlanning/weeklyPlanningTransforms';
import { createAiWeeklyPlanningDialogueRenderer } from '../features/weeklyPlanning/dialogue/weeklyPlanningAiDialogueRenderer';
import { renderWeeklyPlanningDialogueMessage } from '../features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer';
import type { PlanningIntakeState } from '../features/weeklyPlanning/intake/weeklyPlanningIntakeTypes';
import { createAiWeeklyPlanningInterpreter } from '../features/weeklyPlanning/intake/weeklyPlanningAiInterpreter';
import {
  runWeeklyPlanningBehaviorAwarePipeline,
  runWeeklyPlanningBehaviorAwarePipelineWithInterpreter,
} from '../features/weeklyPlanning/pipeline/weeklyPlanningBehaviorAwareIntakePipeline';
import {
  createWeeklyDraftBlocksFromPreviewCandidates,
  createWeeklyPlanningPreviewBlocks,
  createWeeklyPlanningPreviewDisplayBlock,
  removeWeeklyPlanningPreviewBlock,
  type WeeklyPlanningPreviewBlock,
} from '../features/weeklyPlanning/preview/weeklyPlanningPreviewBlocks';
import type { WeeklyDraftCandidate } from '../features/weeklyPlanning/scheduling/weeklyDraftCandidateGenerator';
import type {
  NaturalLanguageMode,
  NaturalLanguageSuggestion,
  Plan,
  PlanDraft,
  SuggestionField,
  ScheduleTemplate,
  StudyMaterial,
  StudySubject,
} from '../types/domain';

interface NaturalLanguageAssistantProps {
  selectedDate: string;
  userId: string;
  plans: Plan[];
  materials?: StudyMaterial[];
  subjects?: StudySubject[];
  scheduleTemplates?: ScheduleTemplate[];
  timetableTermId?: string;
  onApplyDraft: (draft: PlanDraft, targetPlanId?: string) => Promise<void>;
  weeklyDraftBlocks?: WeeklyPlanDraftBlock[];
  onCreateWeeklyDraftBlocks?: (blocks: WeeklyPlanDraftBlock[]) => void;
  onRemoveWeeklyDraftBlock?: (blockId: string) => void;
  onClearWeeklyDraftBlocks?: () => void;
  onApproveWeeklyDraftBlocks?: () => Promise<void>;
  embedded?: boolean;
}

const WEEKLY_PLANNING_RECENT_TURN_LIMIT = 6;

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

const WEEKLY_DRAFT_PREVIEW_START_HOUR = 0;
const WEEKLY_DRAFT_PREVIEW_END_HOUR = 24;
const WEEKLY_DRAFT_PREVIEW_HOURS = Array.from(
  { length: WEEKLY_DRAFT_PREVIEW_END_HOUR - WEEKLY_DRAFT_PREVIEW_START_HOUR + 1 },
  (_, index) => WEEKLY_DRAFT_PREVIEW_START_HOUR + index,
);
const WEEKLY_DRAFT_PREVIEW_TEN_MINUTE_MARKS = Array.from(
  { length: (WEEKLY_DRAFT_PREVIEW_END_HOUR - WEEKLY_DRAFT_PREVIEW_START_HOUR) * 6 + 1 },
  (_, index) => index,
);
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

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

function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function getWeeklyDraftTimeLabelClass(hour: number): string {
  if (hour === WEEKLY_DRAFT_PREVIEW_START_HOUR) {
    return 'weekly-draft-preview-time-label weekly-draft-preview-time-label--start';
  }

  if (hour === WEEKLY_DRAFT_PREVIEW_END_HOUR) {
    return 'weekly-draft-preview-time-label weekly-draft-preview-time-label--end';
  }

  return 'weekly-draft-preview-time-label';
}

function formatDraftDateLabel(date: string): string {
  const [, month = '', day = ''] = date.split('-');
  const weekdayIndex = new Date(`${date}T00:00:00`).getDay();
  return `${Number(month)}/${Number(day)}（${WEEKDAY_LABELS[weekdayIndex] ?? ''}）`;
}

function getWeeklyDraftToneClass(block: WeeklyPlanDraftBlock): string {
  const key = (block.label || block.subject || block.title).trim();
  const toneIndex =
    Array.from(key || block.id).reduce(
      (sum, character) => sum + character.charCodeAt(0),
      0,
    ) % 8;

  return `weekly-draft-tone-${toneIndex + 1}`;
}

function buildWeeklyDraftPreviewMarkerStyle(
  tenMinuteUnit: number,
): CSSProperties {
  return {
    top: `calc(${tenMinuteUnit} * var(--weekly-draft-preview-ten-minute-height))`,
  };
}

function buildWeeklyDraftPreviewMinuteRangeStyle(
  startMinutes: number,
  endMinutes: number,
  rangeStartMinutes: number,
): CSSProperties {
  const startTenMinuteUnit = (startMinutes - rangeStartMinutes) / 10;
  const durationTenMinuteUnits = Math.max(0, endMinutes - startMinutes) / 10;

  return {
    top: `calc(${startTenMinuteUnit} * var(--weekly-draft-preview-ten-minute-height))`,
    height: `calc(${durationTenMinuteUnits} * var(--weekly-draft-preview-ten-minute-height))`,
  };
}

function buildWeeklyDraftPreviewBlockStyle(
  block: WeeklyPlanDraftBlock,
  rangeStartMinutes: number,
): CSSProperties {
  return buildWeeklyDraftPreviewMinuteRangeStyle(
    minutesFromTime(block.startTime),
    minutesFromTime(block.endTime),
    rangeStartMinutes,
  );
}

function buildExistingPlanPreviewStyle(
  plan: Plan,
  rangeStartMinutes: number,
): CSSProperties {
  return buildWeeklyDraftPreviewMinuteRangeStyle(
    minutesFromTime(plan.startTime),
    minutesFromTime(plan.endTime),
    rangeStartMinutes,
  );
}

function getExistingPlanPreviewSizeClass(plan: Plan): string {
  const durationMinutes = minutesBetween(plan.startTime, plan.endTime);

  if (durationMinutes <= 30) {
    return 'weekly-draft-preview-existing--micro';
  }

  if (durationMinutes <= 45) {
    return 'weekly-draft-preview-existing--tiny';
  }

  if (durationMinutes <= 60) {
    return 'weekly-draft-preview-existing--short';
  }

  return '';
}

function createWeeklyPlanningMessage(
  role: WeeklyPlanningMessage['role'],
  content: string,
): WeeklyPlanningMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

export function NaturalLanguageAssistant({
  selectedDate,
  userId,
  plans,
  materials = [],
  subjects = [],
  scheduleTemplates = [],
  timetableTermId,
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
  const [weeklyDraftPreviewMode, setWeeklyDraftPreviewMode] = useState<
    'overview' | 'day'
  >('overview');
  const [selectedWeeklyDraftDate, setSelectedWeeklyDraftDate] = useState('');
  const [weeklyPlanningMessages, setWeeklyPlanningMessages] = useState<
    WeeklyPlanningMessage[]
  >([]);
  const [weeklyPlanningIntakeState, setWeeklyPlanningIntakeState] =
    useState<PlanningIntakeState | null>(null);
  const [weeklyPlanningPreviewBlocks, setWeeklyPlanningPreviewBlocks] = useState<
    WeeklyPlanningPreviewBlock[]
  >([]);
  const [weeklyPlanningPreviewCandidates, setWeeklyPlanningPreviewCandidates] =
    useState<WeeklyDraftCandidate[]>([]);
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
  const localWeeklyPlanningPreviewDraftBlocks = weeklyPlanningPreviewBlocks.map(
    (block) => createWeeklyPlanningPreviewDisplayBlock(block, userId),
  );
  const hasLocalWeeklyPlanningPreview =
    pendingWeeklyDraftBlocks.length === 0 &&
    localWeeklyPlanningPreviewDraftBlocks.length > 0;
  const visibleWeeklyDraftBlocks =
    pendingWeeklyDraftBlocks.length > 0
      ? pendingWeeklyDraftBlocks
      : localWeeklyPlanningPreviewDraftBlocks;
  const sortedPendingWeeklyDraftBlocks = sortByDateTime(visibleWeeklyDraftBlocks);
  const pendingWeeklyDraftTotalMinutes = visibleWeeklyDraftBlocks.reduce(
    (sum, block) => sum + minutesBetween(block.startTime, block.endTime),
    0,
  );
  const pendingWeeklyDraftDates = Array.from(
    new Set(visibleWeeklyDraftBlocks.map((block) => block.date)),
  ).sort();
  const pendingWeeklyDraftDateRange =
    pendingWeeklyDraftDates.length === 0
      ? '-'
      : pendingWeeklyDraftDates[0] ===
          pendingWeeklyDraftDates[pendingWeeklyDraftDates.length - 1]
        ? pendingWeeklyDraftDates[0]
        : `${pendingWeeklyDraftDates[0]}〜${
            pendingWeeklyDraftDates[pendingWeeklyDraftDates.length - 1]
          }`;
  const pendingWeeklyDraftDateGroups = pendingWeeklyDraftDates.map((date) => ({
    date,
    blocks: sortedPendingWeeklyDraftBlocks.filter((block) => block.date === date),
    existingPlans: sortByDateTime(plans.filter((plan) => plan.date === date)),
  }));
  const activeWeeklyDraftDate = pendingWeeklyDraftDates.includes(selectedWeeklyDraftDate)
    ? selectedWeeklyDraftDate
    : pendingWeeklyDraftDates[0] ?? '';
  const activeWeeklyDraftDateIndex = pendingWeeklyDraftDates.indexOf(activeWeeklyDraftDate);
  const activeWeeklyDraftBlocks = activeWeeklyDraftDate
    ? sortedPendingWeeklyDraftBlocks.filter(
        (block) => block.date === activeWeeklyDraftDate,
      )
    : [];
  const activeWeeklyExistingPlans = activeWeeklyDraftDate
    ? sortByDateTime(plans.filter((plan) => plan.date === activeWeeklyDraftDate))
    : [];
  const pendingWeeklyDraftPreviewStartMinutes =
    WEEKLY_DRAFT_PREVIEW_START_HOUR * 60;
  const pendingWeeklyDraftPreviewEndMinutes = WEEKLY_DRAFT_PREVIEW_END_HOUR * 60;
  const pendingWeeklyDraftPreviewDurationMinutes =
    pendingWeeklyDraftPreviewEndMinutes - pendingWeeklyDraftPreviewStartMinutes;

  const WEEKLY_DRAFT_OVERVIEW_HOUR_HEIGHT = 22;
  const WEEKLY_DRAFT_DAY_HOUR_HEIGHT = 44;

  const pendingWeeklyDraftOverviewTimelineHeight =
    (pendingWeeklyDraftPreviewDurationMinutes / 60) *
    WEEKLY_DRAFT_OVERVIEW_HOUR_HEIGHT;

  const pendingWeeklyDraftDayTimelineHeight =
    (pendingWeeklyDraftPreviewDurationMinutes / 60) *
    WEEKLY_DRAFT_DAY_HOUR_HEIGHT;
  const pendingWeeklyDraftPreviewGridStyle: CSSProperties = {
    gridTemplateColumns: `56px repeat(${Math.max(
      pendingWeeklyDraftDateGroups.length,
      1,
    )}, minmax(44px, 1fr))`,
  };

  const pendingWeeklyDraftOverviewTimelineStyle = {
    height: `${pendingWeeklyDraftOverviewTimelineHeight}px`,
    '--weekly-draft-preview-hour-height': `${WEEKLY_DRAFT_OVERVIEW_HOUR_HEIGHT}px`,
    '--weekly-draft-preview-ten-minute-height': `${WEEKLY_DRAFT_OVERVIEW_HOUR_HEIGHT / 6}px`,
  } as CSSProperties;

  const pendingWeeklyDraftDayTimelineStyle = {
    height: `${pendingWeeklyDraftDayTimelineHeight}px`,
    '--weekly-draft-preview-hour-height': `${WEEKLY_DRAFT_DAY_HOUR_HEIGHT}px`,
    '--weekly-draft-preview-ten-minute-height': `${WEEKLY_DRAFT_DAY_HOUR_HEIGHT / 6}px`,
  } as CSSProperties;
  const canCreateWeeklyDraft = text.trim().length > 0;

  function appendWeeklyPlanningMessage(
    role: WeeklyPlanningMessage['role'],
    content: string,
  ) {
    setWeeklyPlanningMessages((current) => [
      ...current,
      createWeeklyPlanningMessage(role, content),
    ].slice(-24));
  }

  function resetWeeklyPlanningSession() {
    setWeeklyPlanningIntakeState(null);
    setWeeklyPlanningPreviewBlocks([]);
    setWeeklyPlanningPreviewCandidates([]);
    setWeeklyPlanningMessages([]);
    setSelectedWeeklyDraftDate('');
    setWeeklyDraftPreviewMode('overview');
    setError('');
    setStatus('');
    setText('');
  }

  function clearWeeklyPlanningDrafts() {
    onClearWeeklyDraftBlocks?.();
    resetWeeklyPlanningSession();
  }

  function clearWeeklyPlanningDraftsOnly() {
    onClearWeeklyDraftBlocks?.();
    setWeeklyPlanningPreviewBlocks([]);
    setWeeklyPlanningPreviewCandidates([]);
    setSelectedWeeklyDraftDate('');
    setWeeklyDraftPreviewMode('overview');
    setError('');
    setStatus('');
  }

  function removeLocalWeeklyPlanningPreviewBlock(blockId: string) {
    const nextPreview = removeWeeklyPlanningPreviewBlock({
      previewBlocks: weeklyPlanningPreviewBlocks,
      candidates: weeklyPlanningPreviewCandidates,
      blockId,
    });
    const nextDates = Array.from(
      new Set(nextPreview.previewBlocks.map((block) => block.date)),
    ).sort();

    setWeeklyPlanningPreviewBlocks(nextPreview.previewBlocks);
    setWeeklyPlanningPreviewCandidates(nextPreview.candidates);
    if (nextPreview.previewBlocks.length === 0) {
      setSelectedWeeklyDraftDate('');
      setWeeklyDraftPreviewMode('overview');
    } else if (!nextDates.includes(selectedWeeklyDraftDate)) {
      setSelectedWeeklyDraftDate(nextDates[0] ?? '');
    }
  }

  function removeVisibleWeeklyDraftBlock(blockId: string) {
    if (hasLocalWeeklyPlanningPreview) {
      removeLocalWeeklyPlanningPreviewBlock(blockId);
      return;
    }

    onRemoveWeeklyDraftBlock?.(blockId);
  }

  function renderWeeklyPlanningHistory() {
    if (weeklyPlanningMessages.length === 0) {
      return null;
    }

    return (
      <div className="weekly-planning-chat-log" aria-label="週間計画の会話履歴">
        {weeklyPlanningMessages.map((message) => (
          <div
            className={`weekly-planning-chat-message weekly-planning-chat-message--${message.role}`}
            key={message.id}
          >
            <strong>{message.role === 'user' ? 'あなた' : 'アプリ'}</strong>
            <p>{message.content}</p>
          </div>
        ))}
      </div>
    );
  }

  async function handleAnalyze() {
    if (!text.trim()) {
      setError('自然言語の入力内容を入れてください。');
      return;
    }

    if (looksLikeWeeklyPlanningRequest(text)) {
      setError('複数タスクの週間計画は「週間計画」モードで作成してください。');
      setStatus('');
      setSuggestions([]);
      setEditTargetPlanId('');
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

      if (nextSuggestions.length === 0) {
        setError('叩き台を作れませんでした。入力内容を少し具体的にしてください。');
        setStatus('');
        setSuggestions([]);
        setEditTargetPlanId('');
        return;
      }

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
    const trimmedText = text.trim();

    if (!trimmedText) {
      setError('週間計画にしたい内容を入力してください。');
      return;
    }

    appendWeeklyPlanningMessage('user', trimmedText);
    setIsAnalyzing(true);

    try {
      const pipelineInput = {
        previousState: weeklyPlanningIntakeState ?? undefined,
        recentTurns: weeklyPlanningMessages
          .slice(-WEEKLY_PLANNING_RECENT_TURN_LIMIT)
          .map(({ role, content }) => ({ role, content })),
        userText: trimmedText,
        planningStartDate: selectedDate,
        planningDayCount: 7,
        sessionPolicy: {
          firstDayStartTime: '09:00',
          dayStartTime: '09:00',
          dayEndTime: '22:00',
          breakMinutes: 10,
        },
        existingPlans: plans,
        scheduleTemplates,
        timetableTermId,
      };
      const aiConfig = getAiConfig();
      const shouldUseAiInterpreter =
        aiConfig.provider !== 'rules' && !getAiConfigValidationMessage(aiConfig);
      const pipelineOutput = shouldUseAiInterpreter
        ? await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter({
          ...pipelineInput,
          interpreter: createAiWeeklyPlanningInterpreter(aiConfig),
        }, {
          useAiDialoguePlanner: true,
        })
        : await runWeeklyPlanningBehaviorAwarePipeline(pipelineInput);
      const isExamFlow = Boolean(pipelineOutput.state.examPrepScope);
      const dialogueRenderer = isExamFlow && shouldUseAiInterpreter
        ? createAiWeeklyPlanningDialogueRenderer(aiConfig)
        : undefined;
      const message = isExamFlow
        ? await renderWeeklyPlanningDialogueMessage({
          state: pipelineOutput.state,
          decision: pipelineOutput.decision,
          renderer: dialogueRenderer,
        })
        : pipelineOutput.behaviorDialogue.message;
      const nextPreviewCandidates = pipelineOutput.draftCandidates ?? [];
      const nextPreviewBlocks = createWeeklyPlanningPreviewBlocks(
        nextPreviewCandidates,
      );

      setWeeklyPlanningIntakeState(pipelineOutput.state);
      setWeeklyPlanningPreviewCandidates(nextPreviewCandidates);
      setWeeklyPlanningPreviewBlocks(nextPreviewBlocks);
      if (nextPreviewBlocks.length > 0) {
        setWeeklyDraftPreviewMode('overview');
        setSelectedWeeklyDraftDate('');
      }
      setError('');
      setStatus(message);
      appendWeeklyPlanningMessage('assistant', message);
      setText('');
    } catch {
      const message = '週間計画の会話状態を更新できませんでした。';
      setError(message);
      setStatus('');
      appendWeeklyPlanningMessage('assistant', message);
      setText('');
    } finally {
      setIsAnalyzing(false);
    }
  }

  function handlePromoteWeeklyPreviewToDrafts() {
    if (!onCreateWeeklyDraftBlocks || weeklyPlanningPreviewCandidates.length === 0) {
      return;
    }

    const blocks = createWeeklyDraftBlocksFromPreviewCandidates({
      candidates: weeklyPlanningPreviewCandidates,
      userId,
      createdAt: new Date().toISOString(),
    });

    if (blocks.length === 0) {
      return;
    }

    onCreateWeeklyDraftBlocks(blocks);
    setWeeklyPlanningPreviewCandidates([]);
    setWeeklyPlanningPreviewBlocks([]);
    setSelectedWeeklyDraftDate('');
    setWeeklyDraftPreviewMode('overview');
    setError('');
    const message = '仮予定として追加しました。内容を確認して、承認または破棄してください。';
    setStatus(message);
    appendWeeklyPlanningMessage('assistant', message);
    setText('');
  }

  async function handleApproveWeeklyDrafts() {
    if (!onApproveWeeklyDraftBlocks || pendingWeeklyDraftBlocks.length === 0) {
      return;
    }

    setIsAnalyzing(true);
    try {
      await onApproveWeeklyDraftBlocks();
      setError('');
      const message = `${pendingWeeklyDraftBlocks.length}件の仮予定を通常予定として保存しました。`;
      setStatus(message);
      appendWeeklyPlanningMessage('assistant', message);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : '仮予定の承認に失敗しました。',
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  function openWeeklyDraftDay(date: string) {
    setSelectedWeeklyDraftDate(date);
    setWeeklyDraftPreviewMode('day');
  }

  function moveWeeklyDraftDay(offset: number) {
    if (activeWeeklyDraftDateIndex < 0) {
      return;
    }

    const nextDate = pendingWeeklyDraftDates[activeWeeklyDraftDateIndex + offset];
    if (!nextDate) {
      return;
    }

    setSelectedWeeklyDraftDate(nextDate);
    setWeeklyDraftPreviewMode('day');
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
            setWeeklyPlanningPreviewBlocks([]);
            setWeeklyPlanningPreviewCandidates([]);
            setWeeklyPlanningIntakeState(null);
            setError('');
            setStatus('');
            setText('');
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
            setWeeklyPlanningIntakeState(null);
            setWeeklyPlanningPreviewBlocks([]);
            setWeeklyPlanningPreviewCandidates([]);
            setSelectedWeeklyDraftDate('');
            setWeeklyDraftPreviewMode('overview');
            setText('');
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
      ) : visibleWeeklyDraftBlocks.length > 0 ? (
        <div className="weekly-planning-assistant weekly-planning-confirmation-screen">
          <div className="weekly-planning-confirmation-header">
            <strong>週間計画を確認</strong>
          </div>

          {renderWeeklyPlanningHistory()}

          {error || status ? (
            <div
              className={
                error
                  ? 'weekly-planning-response-card warning'
                  : 'weekly-planning-response-card'
              }
            >
              <strong>{error ? '確認が必要です' : '週間計画の状態'}</strong>
              <p>{error || status}</p>
            </div>
          ) : null}

          {hasLocalWeeklyPlanningPreview ? (
            <div className="section-stack">
              <label className="field field-full">
                <span>条件を修正する</span>
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  rows={3}
                  placeholder="例: 風呂を21時にして、固定予定はなし"
                />
                <small className="detail-note">
                  送信すると未保存previewを再計算します。不足や曖昧さが出た場合はpreviewを閉じます。
                </small>
              </label>
              <div className="row-actions">
                {onCreateWeeklyDraftBlocks ? (
                  <button
                    className="primary-button"
                    onClick={handlePromoteWeeklyPreviewToDrafts}
                    type="button"
                    disabled={weeklyPlanningPreviewCandidates.length === 0}
                  >
                    この内容で仮予定にする
                  </button>
                ) : null}
                <button
                  className="primary-button"
                  onClick={() => void handleCreateWeeklyDrafts()}
                  type="button"
                  disabled={isAnalyzing || !canCreateWeeklyDraft}
                >
                  {isAnalyzing ? '送信中...' : '条件を送信'}
                </button>
                <button
                  className="ghost-button"
                  onClick={clearWeeklyPlanningDraftsOnly}
                  type="button"
                >
                  previewを閉じる
                </button>
              </div>
            </div>
          ) : null}

          <div className="weekly-draft-confirmation-main">
              <div className="weekly-draft-summary-hero">
                <span className="weekly-draft-summary-check" aria-hidden="true">
                  ✓
                </span>
                <div className="weekly-draft-summary-main">
                  <strong>
                    {hasLocalWeeklyPlanningPreview
                      ? `${visibleWeeklyDraftBlocks.length}件の未保存previewを表示しています`
                      : `${visibleWeeklyDraftBlocks.length}件の仮予定を作成しました`}
                  </strong>
                  <span className="weekly-draft-status-row">
                    <span>未承認</span>
                    <span>未保存</span>
                  </span>
                </div>
                <div className="weekly-draft-summary-grid">
                  <span>合計時間</span>
                  <strong>
                    {formatMinutes(pendingWeeklyDraftTotalMinutes)}（
                    {pendingWeeklyDraftTotalMinutes.toLocaleString()}分）
                  </strong>
                  <span>対象期間</span>
                  <strong>{pendingWeeklyDraftDateRange}</strong>
                </div>
              </div>
              <div className="weekly-draft-preview" aria-label="未承認週間計画の時間割確認">
                <div className="weekly-draft-preview-switch" role="tablist">
                  <button
                    className={
                      weeklyDraftPreviewMode === 'overview'
                        ? 'weekly-draft-preview-tab active'
                        : 'weekly-draft-preview-tab'
                    }
                    onClick={() => setWeeklyDraftPreviewMode('overview')}
                    type="button"
                  >
                    全体
                  </button>
                  <button
                    className={
                      weeklyDraftPreviewMode === 'day'
                        ? 'weekly-draft-preview-tab active'
                        : 'weekly-draft-preview-tab'
                    }
                    onClick={() => setWeeklyDraftPreviewMode('day')}
                    type="button"
                    disabled={pendingWeeklyDraftDates.length === 0}
                  >
                    日別
                  </button>
                </div>

                {weeklyDraftPreviewMode === 'overview' ? (
                  <>
                    <p className="detail-note">
                      日付をタップすると、その日の詳細を確認できます。
                    </p>
                    <div className="weekly-draft-preview-scroll">
                      <div className="weekly-draft-preview-grid">
                        <div
                          className="weekly-draft-preview-header"
                          style={pendingWeeklyDraftPreviewGridStyle}
                        >
                          <span className="weekly-draft-preview-corner">時間</span>
                          {pendingWeeklyDraftDateGroups.map((group) => (
                            <button
                              className="weekly-draft-preview-date"
                              key={group.date}
                              onClick={() => openWeeklyDraftDay(group.date)}
                              type="button"
                            >
                              <strong>{formatDraftDateLabel(group.date)}</strong>
                              <small>{group.blocks.length}件</small>
                            </button>
                          ))}
                        </div>
                        <div
                          className="weekly-draft-preview-body"
                          style={pendingWeeklyDraftPreviewGridStyle}
                        >
                          <div
                            className="weekly-draft-preview-time-axis"
                            style={pendingWeeklyDraftOverviewTimelineStyle}
                          >
                            {WEEKLY_DRAFT_PREVIEW_HOURS.map((hour) => (
                              <span
                                className={getWeeklyDraftTimeLabelClass(hour)}
                                key={hour}
                                style={buildWeeklyDraftPreviewMarkerStyle(
                                  (hour - WEEKLY_DRAFT_PREVIEW_START_HOUR) * 6,
                                )}
                              >
                                {formatHourLabel(hour)}
                              </span>
                            ))}
                          </div>
                          {pendingWeeklyDraftDateGroups.map((group) => (
                            <button
                              className="weekly-draft-preview-day-column"
                              key={group.date}
                              onClick={() => openWeeklyDraftDay(group.date)}
                              style={pendingWeeklyDraftOverviewTimelineStyle}
                              type="button"
                            >
                              {WEEKLY_DRAFT_PREVIEW_HOURS.map((hour) => (
                                <span
                                  className="weekly-draft-preview-hour-line"
                                  key={`${group.date}-${hour}`}
                                  style={buildWeeklyDraftPreviewMarkerStyle(
                                    (hour - WEEKLY_DRAFT_PREVIEW_START_HOUR) * 6,
                                  )}
                                />
                              ))}
                              {group.existingPlans.map((plan) => (
                                <span
                                  className={[
                                    'weekly-draft-preview-existing weekly-draft-preview-existing--overview',
                                    getExistingPlanPreviewSizeClass(plan),
                                  ]
                                    .filter(Boolean)
                                    .join(' ')}
                                  key={plan.id}
                                  style={buildExistingPlanPreviewStyle(
                                    plan,
                                    pendingWeeklyDraftPreviewStartMinutes,
                                  )}
                                  title={`${plan.title} / ${plan.startTime}-${plan.endTime}`}
                                >
                                  <strong>{plan.title}</strong>
                                  <small>{plan.startTime}-{plan.endTime}</small>
                                </span>
                              ))}
                              {group.blocks.map((block) => (
                                <span
                                  className={`weekly-draft-preview-block weekly-draft-preview-block--overview ${getWeeklyDraftToneClass(block)}`}
                                  key={block.id}
                                  style={buildWeeklyDraftPreviewBlockStyle(
                                    block,
                                    pendingWeeklyDraftPreviewStartMinutes,
                                  )}
                                  title={`${block.title} / ${block.startTime}-${block.endTime}`}
                                >
                                  <strong>{block.title}</strong>
                                  <small>
                                    {block.startTime}-{block.endTime}
                                  </small>
                                </span>
                              ))}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="weekly-draft-day-detail">
                    <div className="weekly-draft-day-detail-header">
                      <strong>
                        {activeWeeklyDraftDate
                          ? formatDraftDateLabel(activeWeeklyDraftDate)
                          : '日別詳細'}
                      </strong>
                    </div>
                    <div className="weekly-draft-day-nav">
                      <button
                        className="ghost-button"
                        disabled={activeWeeklyDraftDateIndex <= 0}
                        onClick={() => moveWeeklyDraftDay(-1)}
                        type="button"
                      >
                        前日
                      </button>
                      <span>{activeWeeklyDraftBlocks.length}件</span>
                      <button
                        className="ghost-button"
                        disabled={
                          activeWeeklyDraftDateIndex < 0 ||
                          activeWeeklyDraftDateIndex >= pendingWeeklyDraftDates.length - 1
                        }
                        onClick={() => moveWeeklyDraftDay(1)}
                        type="button"
                      >
                        翌日
                      </button>
                    </div>
                    <div className="weekly-draft-preview-scroll weekly-draft-preview-scroll--day">
                      <div className="weekly-draft-day-grid">
                        <div
                          className="weekly-draft-preview-time-axis weekly-draft-day-time-axis"
                          style={pendingWeeklyDraftDayTimelineStyle}
                        >
                          {WEEKLY_DRAFT_PREVIEW_HOURS.map((hour) => (
                            <span
                              className={getWeeklyDraftTimeLabelClass(hour)}
                              key={hour}
                              style={buildWeeklyDraftPreviewMarkerStyle(
                                (hour - WEEKLY_DRAFT_PREVIEW_START_HOUR) * 6,
                              )}
                            >
                              {formatHourLabel(hour)}
                            </span>
                          ))}
                        </div>
                        <div
                          className="weekly-draft-day-column"
                          style={pendingWeeklyDraftDayTimelineStyle}
                        >
                          {WEEKLY_DRAFT_PREVIEW_TEN_MINUTE_MARKS.map((unit) => (
                            <span
                              className={
                                unit % 6 === 0
                                  ? 'weekly-draft-ten-minute-guide weekly-draft-ten-minute-guide--hour'
                                  : unit % 3 === 0
                                    ? 'weekly-draft-ten-minute-guide weekly-draft-ten-minute-guide--half'
                                    : 'weekly-draft-ten-minute-guide'
                              }
                              key={unit}
                              style={buildWeeklyDraftPreviewMarkerStyle(unit)}
                            />
                          ))}
                          {activeWeeklyExistingPlans.map((plan) => (
                            <div
                              className="weekly-draft-preview-existing weekly-draft-preview-existing--detail"
                              key={plan.id}
                              style={buildExistingPlanPreviewStyle(
                                plan,
                                pendingWeeklyDraftPreviewStartMinutes,
                              )}
                              title={`${plan.title} / ${plan.startTime}-${plan.endTime}`}
                            >
                              <span className="weekly-draft-preview-block-main">
                                <strong>{plan.title}</strong>
                                <small>
                                  {plan.startTime}-{plan.endTime}
                                </small>
                              </span>
                            </div>
                          ))}
                          {activeWeeklyDraftBlocks.map((block) => (
                            <div
                              className={`weekly-draft-preview-block weekly-draft-preview-block--detail ${getWeeklyDraftToneClass(block)}`}
                              key={block.id}
                              style={buildWeeklyDraftPreviewBlockStyle(
                                block,
                                pendingWeeklyDraftPreviewStartMinutes,
                              )}
                              title={`${block.title} / ${block.startTime}-${block.endTime}`}
                            >
                              <span className="weekly-draft-preview-block-main">
                                <strong>{block.title}</strong>
                                <small className="weekly-draft-preview-meta-row">
                                  <span>{block.startTime}-{block.endTime}</span>
                                  <span className="weekly-draft-badge">仮予定</span>
                                  <span className="weekly-draft-badge weekly-draft-preview-subject-badge">
                                    {block.label || block.subject || block.title}
                                  </span>
                                </small>
                              </span>
                              {hasLocalWeeklyPlanningPreview || onRemoveWeeklyDraftBlock ? (
                                <button
                                  aria-label={`${block.title}を削除`}
                                  className="weekly-draft-preview-remove"
                                  onClick={() => removeVisibleWeeklyDraftBlock(block.id)}
                                  type="button"
                                >
                                  ×
                                </button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="row-actions weekly-draft-action-bar">
                {!hasLocalWeeklyPlanningPreview && onClearWeeklyDraftBlocks ? (
                  <button
                    className="ghost-button"
                    onClick={clearWeeklyPlanningDraftsOnly}
                    type="button"
                  >
                    一括破棄
                  </button>
                ) : null}
                {!hasLocalWeeklyPlanningPreview && onApproveWeeklyDraftBlocks ? (
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
        </div>
      ) : (
        <div className="section-stack weekly-planning-assistant">
          {renderWeeklyPlanningHistory()}

          <label className="field field-full">
            <span>週間計画にしたいこと</span>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={4}
              placeholder="例: 来週、計算理論と英語を少しずつ進めたい"
            />
            <small className="detail-note">
              条件確認のあと、「この条件で作成」または「配置できる分だけでいい」でのみ仮予定を作成します。
            </small>
          </label>

          <div className="row-actions">
            <button
              className="primary-button"
              onClick={() => void handleCreateWeeklyDrafts()}
              type="button"
              disabled={isAnalyzing || !canCreateWeeklyDraft}
            >
              {isAnalyzing ? '送信中...' : '送信'}
            </button>
            {weeklyPlanningMessages.length > 0 ? (
              <button
                className="ghost-button"
                onClick={clearWeeklyPlanningDrafts}
                type="button"
              >
                履歴をクリア
              </button>
            ) : null}
          </div>

          {error || status ? (
            <div
              className={
                error
                  ? 'weekly-planning-response-card warning'
                  : 'weekly-planning-response-card'
              }
            >
              <strong>
                {error
                  ? '確認が必要です'
                  : weeklyPlanningIntakeState
                    ? '週間計画の確認'
                    : '週間計画の応答'}
              </strong>
              <p>{error || status}</p>
            </div>
          ) : null}

          <div className="assistant-feedback-card">
            <strong>週間計画MVP</strong>
            <p className="detail-note">
              ここで作る仮予定は、承認するまで通常予定として保存されません。
            </p>
          </div>
        </div>
      )}
    </>
  );

  if (embedded) {
    return <div className="section-stack">{content}</div>;
  }

  return <section className="panel section-stack">{content}</section>;
}
