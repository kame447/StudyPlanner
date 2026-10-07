import { afterEach, describe, expect, it } from 'vitest';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime, scriptedRendererReply } from './testUtils/weeklyPlanningScriptedConversationHarness';
import { schedulingDocument, type Json } from './testUtils/weeklyPlanningSchedulingConstraintsFixture';

const SETUP = '来週、アルゴリズムイントロダクションを30ページ読みたい。1ページ4分くらい';
const CORRECTION = 'やっぱり20ページにして、金曜日までに終わらせたい';
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); });

describe('live C weekday deadline correction through production controller', () => {
  it.each([
    ['interaction_v1', 'weekday:friday'], ['legacy_v5', 'weekday:friday'],
    ['interaction_v1', 'weekday:friday', 'advance-week'],
    ['interaction_v1', '2026-10-09'],
  ] as const)('replaces 30 with 20 pages and resolves the Friday deadline in %s (%s)', async (architecture, dateExpression, advanceWeek?: 'advance-week') => {
    let now = '2026-10-08T09:00:00.000Z';
    resetScriptedConversationRuntime();
    provider = installScriptedWeeklyPlanningProvider(call => {
      if (call.kind === 'renderer') return scriptedRendererReply(call, '候補を確認してください。');
      const document = schedulingDocument('A');
      document.availabilityDeclarations = [];
      const task = (document.tasks as Json[])[0];
      const work = (task.workloads as Json[])[0];
      const effort = (task.effortEstimates as Json[])[0];
      if (call.payload?.userText === SETUP) {
        task.sourceText = 'アルゴリズムイントロダクションを30ページ読みたい';
        Object.assign(work, { amount: 30, sourceText: '30ページ読みたい' });
        Object.assign(effort, { minutes: 4, sourceText: '1ページ4分くらい' });
      } else {
        const summary = call.payload?.publicStateSummary as Json;
        document.planningIntent = 'update_plan'; document.planningWindow = null;
        task.existingPublicId = (summary.tasks as Json[])[0].publicId;
        task.sourceText = CORRECTION; task.effortEstimates = [];
        Object.assign(work, { amount: 20, sourceText: '20ページにして' });
        task.temporalConstraints = [{ localId: 'deadline', targetLocalId: 'book', kind: 'deadline', constraintLevel: 'hard',
          dateExpression, namedTimePeriod: null, startTime: null, endTime: null,
          precision: 'exact', sourceText: '金曜日までに終わらせたい' }];
        if (call.payload?.userText === '10月16日まで') {
          task.sourceText = '10月16日まで'; task.workloads = [];
          (task.temporalConstraints as Json[])[0].dateExpression = '2026-10-16';
          (task.temporalConstraints as Json[])[0].sourceText = '10月16日まで';
          document.corrections = [{ localId: 'replace-date', operation: 'replace', replacementLocalId: 'deadline',
            target: { kind: 'temporal_constraint', publicId: (summary.temporalConstraints as Json[])[0].publicId, localId: null, mention: null }, sourceText: '10月16日まで' }];
        } else document.corrections = [{ localId: 'replace', operation: 'replace', replacementLocalId: 'pages',
          target: { kind: 'workload', publicId: (summary.workloads as Json[])[0].publicId, localId: null, mention: '30ページ' },
          sourceText: 'やっぱり20ページにして' }];
      }
      if (!call.schemaProperties.includes('conversationActs')) delete document.conversationActs;
      return JSON.stringify(document);
    });
    const conversation = createScriptedConversation({ provider, architecture, now: () => now });
    const first = await conversation.submit(SETUP);
    expect(first.result?.failure).toBeUndefined();
    expect(conversation.getState().previewCandidates?.length).toBeGreaterThan(0);
    if (advanceWeek) now = '2026-10-12T09:00:00.000Z';
    let corrected = await conversation.submit(CORRECTION);
    if (dateExpression === '2026-10-09') {
      expect(corrected.result?.failure).toBeUndefined();
      expect(conversation.getState().previewCandidates).toEqual([]);
      expect(conversation.getState().intakeState?.lastQuestionContext?.targetSlot).toBe('stable_v5:hard_date_bound_outside_planning_window');
      const renderInput = corrected.calls.find(call => call.kind === 'renderer')?.payload;
      expect(JSON.stringify(renderInput)).toContain('temporal_date_scope');
      expect(JSON.stringify(renderInput)).toContain('applicable_start_or_deadline_date');
      expect(JSON.stringify(renderInput)).not.toContain('insufficient_capacity');
      corrected = await conversation.submit('10月16日まで');
    }
    expect(corrected.result?.failure).toBeUndefined();
    expect(corrected.result?.state.questions).toEqual([]);
    expect(corrected.calls.filter(call => call.kind === 'semantic_generic')).toHaveLength(1);
    const graph = conversation.graph()!;
    const active = new Set(graph.factLifecycles.filter(fact => fact.status === 'active').map(fact => fact.factId));
    expect(graph.workloads.filter(fact => active.has(fact.id)).map(fact => fact.amount)).toEqual([20]);
    expect(graph.temporalConstraints.filter(fact => active.has(fact.id)).map(fact => fact.dateExpression)).toEqual([dateExpression === '2026-10-09' ? '2026-10-16' : dateExpression]);
    const preview = conversation.getState().previewCandidates!;
    expect(preview.length).toBeGreaterThan(0);
    expect(preview.every(candidate => candidate.date >= '2026-10-12' && candidate.date <= '2026-10-16')).toBe(true);
    if (architecture === 'interaction_v1') expect(corrected.result?.interactionOutcome?.kind).toBe('apply');
  });
});
