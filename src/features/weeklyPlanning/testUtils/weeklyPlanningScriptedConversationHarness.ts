import { vi } from 'vitest';
import {
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
  getWeeklyPlanningStableV5RuntimeSession,
} from '../application/weeklyPlanningStableV5RuntimeSession';
import { weeklyPlanningTurnRuntimeGateway } from '../application/weeklyPlanningTurnRuntimeGateway';
import { weeklyPlanningTurnStagingLifecycle } from '../application/weeklyPlanningTurnSideEffects';
import {
  submitWeeklyPlanningApplicationTurn,
  type WeeklyPlanningTurnApplicationServices,
} from '../application/weeklyPlanningTurnApplication';
import { resetWeeklyPlanningTurnMeasurementsForTest } from '../application/weeklyPlanningTurnMeasurement';
import { clearWeeklyPlanningSessionRuntime } from '../planning/weeklyPlanningSessionRuntime';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { resetWeeklyPlanningStableV5FailureDiagnosticsForTest } from '../semantic/weeklyPlanningStableV5FailureDiagnostics';
import { takeWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import type { PlanningState, WeeklyPlanningAction } from '../types';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';
import {
  createWeeklyPlanningControllerSession,
  submitWeeklyPlanningControlledTurn,
} from '../weeklyPlanningTurnController';
import type {
  WeeklyPlanningTurnExecutionResult,
  WeeklyPlanningTurnSubmissionResult,
} from '../weeklyPlanningTurnExecutionTypes';
import { createReadyPlannerDataAvailability } from './plannerDataAvailabilityTest';
import type { MonthEvent, Plan, StudyMaterial } from '../../../types/domain';
import type { WeeklyPlanningStableV5DebugTraceEvent } from '../trace/weeklyPlanningStableV5DebugTrace';
import type { WeeklyPlanningConversationArchitecture } from '../weeklyPlanningConversationArchitecture';

/**
 * Deterministic provider double for full-turn tests. It replaces only the HTTP
 * transport; the controller, runtime gateway, Stable V5 runtime, validators,
 * renderer client and reducer all run as in production.
 */
export type ScriptedProviderCallKind =
  | 'semantic_generic'
  | 'semantic_focused_contextual'
  | 'semantic_focused_authorization'
  | 'semantic_other'
  | 'renderer'
  | 'other';

export interface ScriptedProviderCall {
  index: number;
  /** Complete JSON transport body, including model/options/schema, for differential replay. */
  request: Record<string, unknown>;
  kind: ScriptedProviderCallKind;
  schemaName: string;
  /** Top-level property names of the JSON schema the provider was asked to follow. */
  schemaProperties: string[];
  messages: Array<{ role: string; content: string }>;
  /** Parsed JSON payload; renderer repair instructions retain the original rendering input. */
  payload: Record<string, unknown> | null;
}

export type ScriptedProviderReply =
  | string
  | { failure: 'network' }
  | { failure: 'http'; status: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function callKind(schemaName: string): ScriptedProviderCallKind {
  if (schemaName === 'weekly_planning_stable_v5_dialogue_response') return 'renderer';
  if (schemaName === 'weekly_planning_semantic_document_v5') return 'semantic_generic';
  if (schemaName === 'weekly_planning_focused_contextual_answer_v5') return 'semantic_focused_contextual';
  if (schemaName.includes('focused_authorization')) return 'semantic_focused_authorization';
  if (schemaName.startsWith('weekly_planning_')) return 'semantic_other';
  return 'other';
}

function lastUserPayload(messages: Array<{ role: string; content: string }>): Record<string, unknown> | null {
  const user = [...messages].reverse().find((message) => message.role === 'user');
  if (!user) return null;
  try {
    const parsed = JSON.parse(user.content) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function installScriptedWeeklyPlanningProvider(
  respond: (call: ScriptedProviderCall) => ScriptedProviderReply | Promise<ScriptedProviderReply>,
  options: { completenessAudit?: 'complete' | 'scripted' } = {},
): { calls: ScriptedProviderCall[]; restore(): void } {
  const calls: ScriptedProviderCall[] = [];
  vi.stubEnv('VITE_AI_PROVIDER', 'openai');
  vi.stubEnv('VITE_AI_BASE_URL', 'https://issue488.fixture.test/v1');
  vi.stubEnv('VITE_AI_MODEL', 'issue488-fixture');
  vi.stubEnv('VITE_AI_API_KEY', 'issue488-fixture-key');
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      messages?: Array<{ role: string; content: string }>;
      response_format?: { json_schema?: { name?: string; schema?: { properties?: Record<string, unknown> } } };
    };
    const messages = body.messages ?? [];
    const schemaName = body.response_format?.json_schema?.name ?? '';
    const call: ScriptedProviderCall = {
      index: calls.length,
      request: body,
      kind: callKind(schemaName),
      schemaName,
      schemaProperties: Object.keys(body.response_format?.json_schema?.schema?.properties ?? {}),
      messages,
      payload: lastUserPayload(messages) ?? (schemaName === 'weekly_planning_stable_v5_dialogue_response'
        ? lastUserPayload(messages.slice(0, 2)) : null),
    };
    calls.push(call);
    // Most scenarios specify interpretation/renderer behavior, not auditor
    // quality. Answer this independent schema explicitly; it remains a real,
    // counted transport dispatch. Audit scenarios opt into their own script.
    const reply = call.schemaName === 'weekly_planning_dense_turn_completeness_audit_v5'
      && options.completenessAudit !== 'scripted'
      ? JSON.stringify({ decision: 'complete', missingFacts: [] })
      : await respond(call);
    if (typeof reply !== 'string') {
      if (reply.failure === 'network') throw new TypeError('fetch failed: issue488 fixture network outage');
      return new Response(JSON.stringify({ error: { message: 'fixture outage' } }), {
        status: reply.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: reply } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  return {
    calls,
    restore() {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    },
  };
}

/** Echoes the renderer contract so the AI-rendered branch is exercised with a fixed text. */
/**
 * The user text a semantic call interprets: the payload's `userText`, or - for a completeness re-read, whose payload
 * carries none - the exact userText quoted in its retry instruction message.
 */
export function scriptedSemanticUserText(call: ScriptedProviderCall): string | undefined {
  const fromPayload = call.payload?.userText;
  if (typeof fromPayload === 'string') return fromPayload;
  for (const message of [...call.messages].reverse()) {
    const match = /The exact current userText to interpret is ("(?:[^"\\]|\\.)*")/.exec(message.content);
    if (match) {
      try { return JSON.parse(match[1]) as string; } catch { return undefined; }
    }
  }
  return undefined;
}

export function scriptedRendererReply(call: ScriptedProviderCall, text: string): string {
  const decision = isRecord(call.payload?.applicationDecision) ? call.payload.applicationDecision : {};
  return JSON.stringify({
    ...(call.schemaProperties.includes('feasibilityClaim') ? { feasibilityClaim: 'none' } : {}),
    actionId: call.payload?.actionId ?? null,
    actionKind: decision.actionKind ?? 'status',
    questionCode: decision.questionCode ?? null,
    groundingAcknowledgement: null,
    text,
  });
}

export interface ScriptedConversationTurn {
  submission: WeeklyPlanningTurnSubmissionResult;
  result: WeeklyPlanningTurnExecutionResult | null;
  calls: ScriptedProviderCall[];
  debugTrace: WeeklyPlanningStableV5DebugTraceEvent[];
  requestId: string | null;
}

export interface ScriptedConversation {
  submit(userText: string): Promise<ScriptedConversationTurn>;
  getState(): PlanningState;
  dispatch(action: WeeklyPlanningAction): PlanningState;
  graph(): WeeklyPlanningFactGraphV5 | null;
  readonly ownerId: string;
  readonly conversationId: string;
  readonly weekStartDate: string;
}

export function resetScriptedConversationRuntime(): void {
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  clearWeeklyPlanningSessionRuntime();
  resetWeeklyPlanningStableV5FailureDiagnosticsForTest();
  resetWeeklyPlanningTurnMeasurementsForTest();
}

export function createScriptedConversation(params: {
  provider: { calls: ScriptedProviderCall[] };
  ownerId?: string;
  conversationId?: string;
  weekStartDate?: string;
  now?: () => string;
  /** Monotonic ms clock for the turn measurement (fake clock in tests). */
  measurementClock?: () => number;
  studyMaterials?: StudyMaterial[];
  /** Existing schedule rows the product would hand to the turn (default: none). */
  plans?: Plan[];
  monthEvents?: MonthEvent[];
  initialState?: PlanningState;
  /** Pins the conversation to an architecture before its first turn (otherwise: new-conversation default). */
  architecture?: WeeklyPlanningConversationArchitecture;
}): ScriptedConversation {
  const ownerId = params.ownerId ?? 'issue488-owner';
  const conversationId = params.conversationId ?? 'issue488-conversation';
  const weekStartDate = params.weekStartDate ?? '2026-10-05';
  const now = params.now ?? (() => '2026-10-07T09:00:00.000Z');
  let state: PlanningState = params.initialState ?? {
    ...createInitialPlanningState(weekStartDate),
    ...(params.architecture ? { conversationArchitecture: params.architecture } : {}),
  };
  const dispatch = (action: WeeklyPlanningAction) => {
    state = weeklyPlanningReducer(state, action);
    return state;
  };
  const session = createWeeklyPlanningControllerSession(ownerId, weekStartDate, conversationId);
  let captured: WeeklyPlanningTurnExecutionResult | null = null;
  let requestId: string | null = null;
  const services: WeeklyPlanningTurnApplicationServices = {
    submitControlledTurn: submitWeeklyPlanningControlledTurn,
    runtimeGateway: {
      async execute(runtimeParams) {
        requestId = runtimeParams.pending.requestId;
        captured = await weeklyPlanningTurnRuntimeGateway.execute(runtimeParams);
        return captured;
      },
    },
    stagingLifecycle: weeklyPlanningTurnStagingLifecycle,
    outcomeLifecycle: {
      committed: () => undefined,
      discarded: () => undefined,
      failed: () => undefined,
    },
  };
  return {
    ownerId,
    conversationId,
    weekStartDate,
    getState: () => state,
    dispatch,
    graph: () => getWeeklyPlanningStableV5RuntimeSession(conversationId)?.graph ?? null,
    async submit(userText) {
      captured = null;
      requestId = null;
      const before = params.provider.calls.length;
      const submission = await submitWeeklyPlanningApplicationTurn({
        session,
        userId: ownerId,
        ownerId,
        userText,
        selectedDate: weekStartDate,
        now,
        measurementClock: params.measurementClock,
        plans: params.plans ?? [],
        ...(params.monthEvents ? { monthEvents: params.monthEvents } : {}),
        studyMaterials: params.studyMaterials ?? [],
        scheduleTemplates: [],
        plannerDataAvailability: createReadyPlannerDataAvailability(ownerId),
        weekStartsOn: 'monday',
        timeZone: 'Asia/Tokyo',
        getState: () => state,
        dispatch,
      }, services);
      const turnRequestId = requestId as string | null;
      return {
        submission,
        result: captured,
        calls: params.provider.calls.slice(before),
        debugTrace: turnRequestId ? takeWeeklyPlanningStableV5DebugTrace(turnRequestId) : [],
        requestId: turnRequestId,
      };
    },
  };
}
