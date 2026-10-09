import { afterEach, describe, expect, it } from 'vitest';
import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import {
  createScriptedConversation,
  installScriptedWeeklyPlanningProvider,
  resetScriptedConversationRuntime,
  scriptedRendererReply,
} from './testUtils/weeklyPlanningScriptedConversationHarness';

/*
 * Issue #488 round 4b, X3-T3 (live): the user states a content quantity and its rate in one clause.
 * The reading binds the task, adds the workload and quotes the whole clause for the workload, so the
 * quote "covers" the rate that no typed effort represents. Literal coverage must not treat a quote as
 * covering digits that its own typed values do not account for: the completeness audit has to run.
 */
type Json = Record<string, unknown>;
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); });

const T1 = '来週、化学の参考書を進めたいんだけど、どのくらい時間がかかるか見当がつかない';
const T3 = 'じゃあ3章ぶん、1章40分で見ておく';
const AUDIT = 'weekly_planning_dense_turn_completeness_audit_v5';
const doc = (o: Json = {}): Json => ({
  schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null, tasks: [], relations: [],
  availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [],
  conversationActs: [], ...o,
});
const task = (id: string | null, sourceText: string, extra: Json = {}): Json => ({
  localId: 'chem', existingPublicId: id, decompositionStatus: 'needs_breakdown', category: 'study', title: '化学の参考書',
  study: { purpose: 'self_study', activityKind: 'other', contextLabel: null, components: [] }, workloads: [], effortEstimates: [],
  temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText, ...extra,
});
const chapters = (sourceText: string): Json => ({
  localId: 'wl', quantityRole: 'target', amount: 3, unitCode: 'chapter', unitLabel: '章', rangeStart: null, rangeEnd: null,
  perOccurrence: false, periodExpression: null, sourceText,
});

describe('X3-T3: a workload quote that carries a rate the typed values do not account for', () => {
  it.each(['3章ぶん、1章40分', '3章ぶん'])('workload quote %s: the completeness audit runs', async quote => {
    provider = installScriptedWeeklyPlanningProvider(call => {
      if (call.kind === 'renderer') return scriptedRendererReply(call, 'わかりました。');
      if (call.schemaName === AUDIT) return JSON.stringify({ decision: 'complete', missingFacts: [] });
      if (call.kind !== 'semantic_generic') {
        return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
      }
      const text = String(call.payload?.userText ?? '');
      const id = (((call.payload?.publicStateSummary as Json)?.tasks ?? []) as Json[])[0]?.publicId as string | undefined;
      if (text === T1) {
        return JSON.stringify(doc({
          planningIntent: 'create_plan',
          planningWindow: { localId: 'w', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
          tasks: [task(null, '化学の参考書を進めたい')],
          uncertainties: [{ localId: 'u', targetLocalId: 'chem', field: 'work_breakdown', reason: 'r', sourceText: '化学の参考書を進めたい' }],
        }));
      }
      return JSON.stringify(doc({ tasks: [task(id!, quote, { workloads: [chapters(quote)] })] }));
    });
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', weekStartDate: '2026-10-12', now: () => '2026-10-08T00:00:00.000Z' });
    await conversation.submit(T1);
    const third = await conversation.submit(T3);
    expect(third.calls.some(call => call.schemaName === AUDIT)).toBe(true);
  });
});
