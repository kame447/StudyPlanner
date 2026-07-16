import { writeFileSync } from 'node:fs';

writeFileSync('src/features/weeklyPlanning/types.ts', `import type { PlanType } from '../../types/domain';
import type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';
import type {
  PreviewAssumptionDependency,
  WeeklyPreviewMetadata,
} from './planning/weeklyPlanningApprovalTypes';

export type AiInputMode = 'chat' | 'weekly_planning';

export type WeeklyPlanningMode =
  | 'idle'
  | 'collecting_tasks'
  | 'draft_created'
  | 'awaiting_approval'
  | 'confirmed';

export type WeeklyPlanDraftStatus = 'draft' | 'approved' | 'discarded';

export interface WeeklyPlanningBehaviorMetadata {
  conversationId?: string;
  stateRevision: number;
  sourceFactRefs: string[];
  usedAssumptionProposalRefs: string[];
  acceptedAssumptionDependencies?: PreviewAssumptionDependency[];
  taskRef: string;
  opportunityTags: string[];
  reasoningKey: string;
  compatibility: {
    workItemSemantic: 'behavior_aware_task';
    schedulerInputSource: 'exam_prep_request';
    candidateSource: 'weekly_exam_prep';
  };
  previewMetadata?: WeeklyPreviewMetadata;
}

export interface WeeklyPlanDraftBlock {
  id: string;
  userId: string;
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  subject: string;
  type: PlanType;
  label: string;
  materialId?: string | null;
  materialName?: string;
  memo?: string;
  source: 'ai';
  status: WeeklyPlanDraftStatus;
  userEdited: boolean;
  behaviorMetadata?: WeeklyPlanningBehaviorMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface WeeklyPlanningMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface WeeklyPlanningPendingTurn {
  requestId: string;
  weekStartDate: string;
  baseRevision: number;
  startedAt: string;
}

export interface WeeklyPlanningPendingApproval {
  requestId: string;
  weekStartDate: string;
  baseRevision: number;
  blockIds: string[];
  startedAt: string;
}

export interface PlanningState {
  weekStartDate: string;
  revision: number;
  mode: WeeklyPlanningMode;
  draftBlocks: WeeklyPlanDraftBlock[];
  messages: WeeklyPlanningMessage[];
  intakeState?: PlanningIntakeState;
  pendingTurn?: WeeklyPlanningPendingTurn;
  pendingApproval?: WeeklyPlanningPendingApproval;
  lastAssistantMessage?: string;
  updatedAt: string;
}

export type WeeklyPlanningAction =
  | { type: 'load_state'; state: PlanningState }
  | { type: 'add_draft_blocks'; blocks: WeeklyPlanDraftBlock[] }
  | { type: 'remove_draft_block'; blockId: string }
  | { type: 'remove_draft_blocks'; blockIds: string[] }
  | { type: 'clear_draft_blocks' }
  | { type: 'mark_draft_block_user_edited'; blockId: string }
  | { type: 'append_message'; message: WeeklyPlanningMessage }
  | { type: 'set_intake_state'; state: PlanningIntakeState | null }
  | { type: 'clear_conversation' }
  | { type: 'reset_session' }
  | { type: 'set_last_assistant_message'; message: string }
  | {
      type: 'begin_turn';
      pending: WeeklyPlanningPendingTurn;
      userMessage: WeeklyPlanningMessage;
    }
  | {
      type: 'commit_turn';
      pending: WeeklyPlanningPendingTurn;
      intakeState: PlanningIntakeState;
      assistantMessage: WeeklyPlanningMessage;
    }
  | {
      type: 'fail_turn';
      pending: WeeklyPlanningPendingTurn;
      assistantMessage: WeeklyPlanningMessage;
    }
  | { type: 'cancel_turn'; pending: WeeklyPlanningPendingTurn }
  | { type: 'begin_approval'; pending: WeeklyPlanningPendingApproval }
  | {
      type: 'complete_approval';
      pending: WeeklyPlanningPendingApproval;
      completedBlockIds: string[];
      assistantMessage: WeeklyPlanningMessage;
    }
  | { type: 'fail_approval'; pending: WeeklyPlanningPendingApproval };
`, 'utf8');

writeFileSync('src/features/weeklyPlanning/weeklyPlanningReducer.ts', `import type {
  PlanningState,
  WeeklyPlanDraftBlock,
  WeeklyPlanningAction,
  WeeklyPlanningMessage,
  WeeklyPlanningPendingApproval,
  WeeklyPlanningPendingTurn,
} from './types';

function nowIso(): string {
  return new Date().toISOString();
}

export function createInitialPlanningState(weekStartDate: string): PlanningState {
  return {
    weekStartDate,
    revision: 0,
    mode: 'idle',
    draftBlocks: [],
    messages: [],
    updatedAt: nowIso(),
  };
}

function withMutation(state: PlanningState, next: Omit<PlanningState, 'revision' | 'updatedAt'>): PlanningState {
  return {
    ...next,
    revision: state.revision + 1,
    updatedAt: nowIso(),
  };
}

function getPendingDraftBlocks(blocks: WeeklyPlanDraftBlock[]): WeeklyPlanDraftBlock[] {
  return blocks.filter((block) => block.status === 'draft');
}

function samePendingTurn(
  current: WeeklyPlanningPendingTurn | undefined,
  expected: WeeklyPlanningPendingTurn,
): boolean {
  return Boolean(
    current
      && current.requestId === expected.requestId
      && current.weekStartDate === expected.weekStartDate
      && current.baseRevision === expected.baseRevision,
  );
}

function samePendingApproval(
  current: WeeklyPlanningPendingApproval | undefined,
  expected: WeeklyPlanningPendingApproval,
): boolean {
  return Boolean(
    current
      && current.requestId === expected.requestId
      && current.weekStartDate === expected.weekStartDate
      && current.baseRevision === expected.baseRevision,
  );
}

function canCommitTurn(state: PlanningState, pending: WeeklyPlanningPendingTurn): boolean {
  return samePendingTurn(state.pendingTurn, pending)
    && state.weekStartDate === pending.weekStartDate
    && state.revision === pending.baseRevision + 1;
}

function canCommitApproval(
  state: PlanningState,
  pending: WeeklyPlanningPendingApproval,
): boolean {
  return samePendingApproval(state.pendingApproval, pending)
    && state.weekStartDate === pending.weekStartDate
    && state.revision === pending.baseRevision + 1;
}

function appendAssistantMessage(
  state: PlanningState,
  message: WeeklyPlanningMessage,
): Pick<PlanningState, 'messages' | 'lastAssistantMessage'> {
  return {
    messages: [...state.messages, message],
    lastAssistantMessage: message.content,
  };
}

export function weeklyPlanningReducer(
  state: PlanningState,
  action: WeeklyPlanningAction,
): PlanningState {
  if (
    state.pendingApproval
    && action.type !== 'load_state'
    && action.type !== 'complete_approval'
    && action.type !== 'fail_approval'
  ) {
    return state;
  }

  switch (action.type) {
    case 'load_state':
      return action.state;

    case 'begin_turn':
      if (
        state.pendingTurn
        || state.pendingApproval
        || action.pending.weekStartDate !== state.weekStartDate
        || action.pending.baseRevision !== state.revision
      ) {
        return state;
      }
      return withMutation(state, {
        ...state,
        mode: state.mode === 'idle' ? 'collecting_tasks' : state.mode,
        messages: [...state.messages, action.userMessage],
        pendingTurn: action.pending,
      });

    case 'commit_turn':
      if (!canCommitTurn(state, action.pending)) return state;
      return withMutation(state, {
        ...state,
        ...appendAssistantMessage(state, action.assistantMessage),
        intakeState: action.intakeState,
        pendingTurn: undefined,
      });

    case 'fail_turn':
      if (!canCommitTurn(state, action.pending)) return state;
      return withMutation(state, {
        ...state,
        ...appendAssistantMessage(state, action.assistantMessage),
        pendingTurn: undefined,
      });

    case 'cancel_turn':
      if (!samePendingTurn(state.pendingTurn, action.pending)) return state;
      return withMutation(state, {
        ...state,
        pendingTurn: undefined,
      });

    case 'begin_approval': {
      const currentIds = new Set(getPendingDraftBlocks(state.draftBlocks).map((block) => block.id));
      if (
        state.pendingTurn
        || state.pendingApproval
        || action.pending.weekStartDate !== state.weekStartDate
        || action.pending.baseRevision !== state.revision
        || action.pending.blockIds.length === 0
        || action.pending.blockIds.some((blockId) => !currentIds.has(blockId))
      ) {
        return state;
      }
      return withMutation(state, {
        ...state,
        pendingApproval: action.pending,
      });
    }

    case 'complete_approval': {
      if (!canCommitApproval(state, action.pending)) return state;
      const completedIds = new Set(action.completedBlockIds);
      const nextBlocks = state.draftBlocks.filter((block) => !completedIds.has(block.id));
      return withMutation(state, {
        ...state,
        ...appendAssistantMessage(state, action.assistantMessage),
        draftBlocks: nextBlocks,
        mode: nextBlocks.length > 0 ? 'awaiting_approval' : 'idle',
        pendingApproval: undefined,
      });
    }

    case 'fail_approval':
      if (!samePendingApproval(state.pendingApproval, action.pending)) return state;
      return withMutation(state, {
        ...state,
        pendingApproval: undefined,
      });

    case 'add_draft_blocks': {
      if (action.blocks.length === 0) return state;
      return withMutation(state, {
        ...state,
        mode: 'awaiting_approval',
        draftBlocks: [...getPendingDraftBlocks(state.draftBlocks), ...action.blocks],
      });
    }

    case 'remove_draft_block': {
      const nextBlocks = state.draftBlocks.filter((block) => block.id !== action.blockId);
      if (nextBlocks.length === state.draftBlocks.length) return state;
      return withMutation(state, {
        ...state,
        draftBlocks: nextBlocks,
        mode: nextBlocks.length > 0 ? state.mode : 'idle',
      });
    }

    case 'remove_draft_blocks': {
      const blockIds = new Set(action.blockIds);
      const nextBlocks = state.draftBlocks.filter((block) => !blockIds.has(block.id));
      if (nextBlocks.length === state.draftBlocks.length) return state;
      return withMutation(state, {
        ...state,
        draftBlocks: nextBlocks,
        mode: nextBlocks.length > 0 ? state.mode : 'idle',
      });
    }

    case 'clear_draft_blocks':
      if (state.draftBlocks.length === 0) return state;
      return withMutation(state, {
        ...state,
        draftBlocks: [],
        mode: 'idle',
      });

    case 'mark_draft_block_user_edited': {
      const exists = state.draftBlocks.some((block) => block.id === action.blockId);
      if (!exists) return state;
      return withMutation(state, {
        ...state,
        draftBlocks: state.draftBlocks.map((block) =>
          block.id === action.blockId
            ? { ...block, userEdited: true, updatedAt: nowIso() }
            : block,
        ),
      });
    }

    case 'append_message':
      return withMutation(state, {
        ...state,
        mode: state.mode === 'idle' ? 'collecting_tasks' : state.mode,
        messages: [...state.messages, action.message],
      });

    case 'set_intake_state':
      return withMutation(state, {
        ...state,
        intakeState: action.state ?? undefined,
      });

    case 'clear_conversation':
      return withMutation(state, {
        ...state,
        mode: state.draftBlocks.length > 0 ? 'awaiting_approval' : 'idle',
        messages: [],
        intakeState: undefined,
        pendingTurn: undefined,
        lastAssistantMessage: undefined,
      });

    case 'reset_session':
      return withMutation(state, {
        ...state,
        mode: 'idle',
        draftBlocks: [],
        messages: [],
        intakeState: undefined,
        pendingTurn: undefined,
        lastAssistantMessage: undefined,
      });

    case 'set_last_assistant_message':
      return withMutation(state, {
        ...state,
        ...appendAssistantMessage(state, {
          id: \`weekly-planning-message-\${Date.now()}\`,
          role: 'assistant',
          content: action.message,
          createdAt: nowIso(),
        }),
      });

    default:
      return state;
  }
}
`, 'utf8');

writeFileSync('src/features/weeklyPlanning/useWeeklyPlanningState.ts', `import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { startOfWeek } from '../../lib/date';
import type { PlanningState, WeeklyPlanningAction } from './types';
import {
  loadWeeklyPlanningState,
  saveWeeklyPlanningState,
} from './weeklyPlanningStorage';
import {
  createInitialPlanningState,
  weeklyPlanningReducer,
} from './weeklyPlanningReducer';

export function useWeeklyPlanningState(userId: string, selectedDate: string) {
  const weekStartDate = useMemo(() => startOfWeek(selectedDate), [selectedDate]);
  const [planningState, setPlanningState] = useState<PlanningState>(() =>
    createInitialPlanningState(weekStartDate),
  );
  const planningStateRef = useRef(planningState);

  const replacePlanningState = useCallback((nextState: PlanningState) => {
    planningStateRef.current = nextState;
    setPlanningState(nextState);
    return nextState;
  }, []);

  const dispatchPlanningAction = useCallback((action: WeeklyPlanningAction) => {
    const current = planningStateRef.current;
    const next = weeklyPlanningReducer(current, action);
    if (next !== current) replacePlanningState(next);
    return next;
  }, [replacePlanningState]);

  const getPlanningState = useCallback(() => planningStateRef.current, []);

  useEffect(() => {
    replacePlanningState(loadWeeklyPlanningState(userId, weekStartDate));
  }, [replacePlanningState, userId, weekStartDate]);

  useEffect(() => {
    if (planningState.weekStartDate !== weekStartDate) return;
    saveWeeklyPlanningState(userId, planningState);
  }, [planningState, userId, weekStartDate]);

  return {
    planningState,
    dispatchPlanningAction,
    getPlanningState,
  };
}
`, 'utf8');

writeFileSync('src/features/weeklyPlanning/weeklyPlanningStorage.ts', `import type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';
import type { PlanningState, WeeklyPlanDraftBlock, WeeklyPlanningMessage } from './types';
import { createInitialPlanningState } from './weeklyPlanningReducer';

const STORAGE_VERSION = 2;
const MODES = new Set(['idle', 'collecting_tasks', 'draft_created', 'awaiting_approval', 'confirmed']);
const INTAKE_STATUSES = new Set([
  'idle', 'needs_scope', 'range_collected', 'scope_collected', 'needs_exam_info',
  'needs_year_range', 'needs_progress_clarification', 'needs_unit_rate',
  'needs_priority_policy', 'needs_life_constraints', 'draft_ready',
  'revision_pending', 'approved',
]);
const INTAKE_INTENTS = new Set([
  'weekly_study_planning', 'exam_prep_planning', 'regular_schedule', 'study_advice', 'unknown',
]);

interface StoredPlanningStateV2 {
  version: 2;
  state: PlanningState;
}

function getStorageKey(userId: string, weekStartDate: string): string {
  return \`studyplanner.weeklyPlanning.\${userId}.\${weekStartDate}\`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isMessage(value: unknown): value is WeeklyPlanningMessage {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && (value.role === 'user' || value.role === 'assistant')
    && typeof value.content === 'string'
    && typeof value.createdAt === 'string';
}

function isDraftBlock(value: unknown): value is WeeklyPlanDraftBlock {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.userId === 'string'
    && typeof value.date === 'string'
    && typeof value.startTime === 'string'
    && typeof value.endTime === 'string'
    && typeof value.title === 'string'
    && typeof value.subject === 'string'
    && typeof value.type === 'string'
    && typeof value.label === 'string'
    && value.source === 'ai'
    && value.status === 'draft'
    && typeof value.userEdited === 'boolean'
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string';
}

function isPlanningIntakeState(value: unknown): value is PlanningIntakeState {
  if (!isRecord(value)) return false;
  if (!INTAKE_STATUSES.has(String(value.status)) || !INTAKE_INTENTS.has(String(value.intent))) {
    return false;
  }
  if (!isRecord(value.priorityPolicy) || typeof value.priorityPolicy.kind !== 'string') return false;
  return Array.isArray(value.tasks)
    && Array.isArray(value.progress)
    && Array.isArray(value.unitRates)
    && Array.isArray(value.constraints)
    && isStringArray(value.missing)
    && isStringArray(value.assumptions)
    && isStringArray(value.uncertainties)
    && isStringArray(value.questions)
    && typeof value.shouldCreateDraft === 'boolean'
    && value.shouldSavePlan === false
    && isStringArray(value.sourceTurns);
}

function isPlanningState(value: unknown): value is PlanningState {
  if (!isRecord(value)) return false;
  return typeof value.weekStartDate === 'string'
    && Number.isInteger(value.revision)
    && Number(value.revision) >= 0
    && MODES.has(String(value.mode))
    && Array.isArray(value.draftBlocks)
    && value.draftBlocks.every(isDraftBlock)
    && Array.isArray(value.messages)
    && value.messages.every(isMessage)
    && (value.intakeState === undefined || isPlanningIntakeState(value.intakeState))
    && typeof value.updatedAt === 'string';
}

function migrateLegacyPlanningState(value: unknown): PlanningState | null {
  if (!isRecord(value)) return null;
  const candidate = { ...value, revision: Number.isInteger(value.revision) ? value.revision : 0 };
  return isPlanningState(candidate) ? candidate : null;
}

function serializableIntakeState(
  intakeState: PlanningState['intakeState'],
): PlanningState['intakeState'] {
  if (!intakeState) return undefined;
  const { assumptionProposalRecords: _sessionOnlyRecords, ...serializable } = intakeState;
  return serializable;
}

function serializablePlanningState(state: PlanningState): PlanningState {
  const { pendingTurn: _pendingTurn, pendingApproval: _pendingApproval, ...serializable } = state;
  return {
    ...serializable,
    draftBlocks: state.draftBlocks.filter((block) => block.status === 'draft'),
    intakeState: serializableIntakeState(state.intakeState),
  };
}

export function loadWeeklyPlanningState(
  userId: string,
  weekStartDate: string,
): PlanningState {
  if (typeof window === 'undefined') return createInitialPlanningState(weekStartDate);

  try {
    const rawValue = window.localStorage.getItem(getStorageKey(userId, weekStartDate));
    if (!rawValue) return createInitialPlanningState(weekStartDate);
    const parsedValue: unknown = JSON.parse(rawValue);
    const storedState = isRecord(parsedValue)
      && parsedValue.version === STORAGE_VERSION
      && isPlanningState(parsedValue.state)
      ? parsedValue.state
      : migrateLegacyPlanningState(parsedValue);
    if (!storedState) return createInitialPlanningState(weekStartDate);
    return {
      ...storedState,
      weekStartDate,
      pendingTurn: undefined,
      pendingApproval: undefined,
      draftBlocks: storedState.draftBlocks.filter((block) => block.status === 'draft'),
    };
  } catch {
    return createInitialPlanningState(weekStartDate);
  }
}

export function saveWeeklyPlanningState(userId: string, state: PlanningState): void {
  if (typeof window === 'undefined') return;
  const serializableState = serializablePlanningState(state);

  try {
    const key = getStorageKey(userId, state.weekStartDate);
    if (
      serializableState.draftBlocks.length === 0
      && serializableState.messages.length === 0
      && !serializableState.intakeState
    ) {
      window.localStorage.removeItem(key);
      return;
    }
    const envelope: StoredPlanningStateV2 = { version: STORAGE_VERSION, state: serializableState };
    window.localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // localStorage is best effort; the in-memory session remains authoritative.
  }
}
`, 'utf8');

writeFileSync('src/features/weeklyPlanning/weeklyPlanningTurnExecutor.ts', `import { getAiConfig, getAiConfigValidationMessage } from '../../lib/aiConfig';
import type { Plan, ScheduleTemplate } from '../../types/domain';
import { createAiWeeklyPlanningDialogueRenderer } from './dialogue/weeklyPlanningAiDialogueRenderer';
import { renderWeeklyPlanningDialogueMessage } from './dialogue/weeklyPlanningDialogueRenderer';
import { createAiWeeklyPlanningInterpreter } from './intake/weeklyPlanningAiInterpreter';
import type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';
import {
  runWeeklyPlanningBehaviorAwarePipeline,
  runWeeklyPlanningBehaviorAwarePipelineWithInterpreter,
} from './pipeline/weeklyPlanningBehaviorAwareIntakePipeline';
import type { WeeklyDraftCandidate } from './scheduling/weeklyDraftCandidateGenerator';
import type { WeeklyPlanningMessage } from './types';

const RECENT_TURN_LIMIT = 6;

export interface WeeklyPlanningTurnExecutionInput {
  previousState?: PlanningIntakeState;
  messages: readonly WeeklyPlanningMessage[];
  userText: string;
  selectedDate: string;
  userId: string;
  plans: Plan[];
  scheduleTemplates: ScheduleTemplate[];
  timetableTermId?: string;
  traceRequestId: string;
}

export interface WeeklyPlanningTurnExecutionResult {
  state: PlanningIntakeState;
  message: string;
  draftCandidates: WeeklyDraftCandidate[];
}

export async function executeWeeklyPlanningTurn(
  input: WeeklyPlanningTurnExecutionInput,
): Promise<WeeklyPlanningTurnExecutionResult> {
  const pipelineInput = {
    previousState: input.previousState,
    recentTurns: input.messages
      .slice(-RECENT_TURN_LIMIT)
      .map(({ role, content }) => ({ role, content })),
    userText: input.userText,
    planningStartDate: input.selectedDate,
    planningDayCount: 7,
    sessionPolicy: {
      firstDayStartTime: '09:00',
      dayStartTime: '09:00',
      dayEndTime: '22:00',
      breakMinutes: 10,
    },
    existingPlans: input.plans,
    scheduleTemplates: input.scheduleTemplates,
    timetableTermId: input.timetableTermId,
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
      userId: input.userId,
      traceRequestId: input.traceRequestId,
    })
    : await runWeeklyPlanningBehaviorAwarePipeline(pipelineInput, {
      userId: input.userId,
      traceRequestId: input.traceRequestId,
    });
  const isExamFlow = Boolean(pipelineOutput.state.examPrepScope);
  const dialogueRenderer = isExamFlow && shouldUseAiInterpreter
    ? createAiWeeklyPlanningDialogueRenderer(aiConfig)
    : undefined;
  const message = isExamFlow
    ? await renderWeeklyPlanningDialogueMessage({
      state: pipelineOutput.state,
      decision: pipelineOutput.decision,
      renderer: dialogueRenderer,
      userId: input.userId,
      existingPlans: input.plans,
    })
    : pipelineOutput.behaviorDialogue.message;

  return {
    state: pipelineOutput.state,
    message,
    draftCandidates: pipelineOutput.draftCandidates ?? [],
  };
}
`, 'utf8');

writeFileSync('src/features/weeklyPlanning/weeklyPlanningSessionState.property.test.ts', `import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createInitialPlanningIntakeState } from './intake/weeklyPlanningIntakeReducer';
import type {
  WeeklyPlanDraftBlock,
  WeeklyPlanningPendingApproval,
  WeeklyPlanningPendingTurn,
} from './types';
import { createInitialPlanningState, weeklyPlanningReducer } from './weeklyPlanningReducer';

function draftBlock(id: string): WeeklyPlanDraftBlock {
  return {
    id,
    userId: 'user-1',
    date: '2026-07-16',
    startTime: '19:00',
    endTime: '20:00',
    title: id,
    subject: '英語',
    type: 'study',
    label: '英語',
    source: 'ai',
    status: 'draft',
    userEdited: false,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  };
}

function pendingTurn(baseRevision = 0): WeeklyPlanningPendingTurn {
  return {
    requestId: 'request-current',
    weekStartDate: '2026-07-13',
    baseRevision,
    startedAt: '2026-07-16T00:00:00.000Z',
  };
}

function pendingApproval(baseRevision: number): WeeklyPlanningPendingApproval {
  return {
    requestId: 'approval-current',
    weekStartDate: '2026-07-13',
    baseRevision,
    blockIds: ['draft-1', 'draft-2'],
    startedAt: '2026-07-16T00:00:00.000Z',
  };
}

describe('weekly planning session reducer properties', () => {
  it('never commits an arbitrary stale turn identity', () => {
    fc.assert(fc.property(
      fc.record({
        requestId: fc.string({ minLength: 1 }).filter((value) => value !== 'request-current'),
        weekStartDate: fc.date().map((date) => date.toISOString().slice(0, 10)),
        baseRevision: fc.nat({ max: 50 }),
      }),
      (stale) => {
        const initial = createInitialPlanningState('2026-07-13');
        const current = pendingTurn(initial.revision);
        const begun = weeklyPlanningReducer(initial, {
          type: 'begin_turn',
          pending: current,
          userMessage: {
            id: 'user-message', role: 'user', content: '予定', createdAt: current.startedAt,
          },
        });
        const stalePending = { ...current, ...stale };
        const committed = weeklyPlanningReducer(begun, {
          type: 'commit_turn',
          pending: stalePending,
          intakeState: createInitialPlanningIntakeState(),
          assistantMessage: {
            id: 'assistant-message', role: 'assistant', content: '古い結果', createdAt: current.startedAt,
          },
        });
        expect(committed).toBe(begun);
      },
    ));
  });

  it('keeps draft blocks immutable for arbitrary mutation sequences during approval', () => {
    const actionArbitrary = fc.oneof(
      fc.string().map((blockId) => ({ type: 'remove_draft_block' as const, blockId })),
      fc.array(fc.string(), { maxLength: 5 }).map((blockIds) => ({
        type: 'remove_draft_blocks' as const,
        blockIds,
      })),
      fc.constant({ type: 'clear_draft_blocks' as const }),
    );

    fc.assert(fc.property(fc.array(actionArbitrary, { maxLength: 30 }), (actions) => {
      const withDrafts = weeklyPlanningReducer(createInitialPlanningState('2026-07-13'), {
        type: 'add_draft_blocks',
        blocks: [draftBlock('draft-1'), draftBlock('draft-2')],
      });
      const pending = pendingApproval(withDrafts.revision);
      const approving = weeklyPlanningReducer(withDrafts, { type: 'begin_approval', pending });
      const after = actions.reduce(weeklyPlanningReducer, approving);
      expect(after).toBe(approving);
      expect(after.draftBlocks).toEqual(approving.draftBlocks);
    }));
  });

  it('keeps revision monotonic for arbitrary accepted non-load mutations', () => {
    fc.assert(fc.property(fc.array(fc.string(), { maxLength: 40 }), (contents) => {
      let state = createInitialPlanningState('2026-07-13');
      for (const [index, content] of contents.entries()) {
        const previousRevision = state.revision;
        state = weeklyPlanningReducer(state, {
          type: 'append_message',
          message: {
            id: \`message-\${index}\`, role: 'user', content, createdAt: '2026-07-16T00:00:00.000Z',
          },
        });
        expect(state.revision).toBe(previousRevision + 1);
      }
    }));
  });
});
`, 'utf8');

console.log('weekly planning session core applied');
