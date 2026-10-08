import '../application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, describe, expect, it } from 'vitest';
import { stableV5ScheduleQuestionText } from '../application/weeklyPlanningStableV5RuntimeQuestions';
import { createWeeklyPlanningStableV5DialoguePrompt } from './weeklyPlanningStableV5DialoguePrompt';
import { fallbackTextForStableV5TypedIntent } from './weeklyPlanningStableV5TurnDialogue';
import { communicationContextForStableV5Dialogue } from './weeklyPlanningStableV5CommunicationContext';
import { composeWeeklyPlanningInteractionFallbackText } from './weeklyPlanningInteractionFallbackText';
import { weeklyPlanningPreviewOmissionDisclosureText } from './weeklyPlanningPreviewOmissionDisclosure';
import type { WeeklyPlanningStableV5DialogueQuestionIntent, WeeklyPlanningStableV5DialogueRenderInput } from './weeklyPlanningStableV5DialogueContracts';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime } from '../testUtils/weeklyPlanningScriptedConversationHarness';
import { eventDocument, eventStudyTask } from '../testUtils/weeklyPlanningFixedEventOnlyFixture';

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider> | undefined;
afterEach(() => { provider?.restore(); provider = undefined; resetScriptedConversationRuntime(); });

function input(questionIntent: WeeklyPlanningStableV5DialogueQuestionIntent): WeeklyPlanningStableV5DialogueRenderInput {
  return { actionId: 'wording', currentUserMessage: 'synthetic message', recentConversation: [], planningInformation: null,
    actionKind: 'question', questionCode: 'missing_schedulable_work', questionIntent,
    communication: communicationContextForStableV5Dialogue({ outcome: undefined, facts: undefined,
      actionKind: 'question', questionCode: 'missing_schedulable_work', questionIntent }),
    requiredLabels: [], fallbackText: '', previewCount: 0, conversationArchitecture: 'interaction_v1' };
}

const studyIntent = (mode: 'missing_task_identity' | 'all_requested_work_complete'): WeeklyPlanningStableV5DialogueQuestionIntent => ({
  kind: 'schedulable_work_detail', mode, targetFactId: null, progressBasis: null,
  knownUnitCode: null, knownUnitLabel: null,
  requestedInformation: mode === 'missing_task_identity' ? ['task_identity'] : ['additional_task_or_constraint'],
});

describe('typed question category renderer contract', () => {
  it.each(['confirm_existing_schedule', 'register_event', 'clarify_schedule_request'] as const)
    ('keeps %s purpose in renderer and emergency text', purpose => {
      const context = input({ kind: 'schedule_request', purpose, requestedInformation: ['schedule_request'] });
      expect(context.communication!.questionPurposes).toEqual([purpose]);
      const text = fallbackTextForStableV5TypedIntent({ applicationText: 'internal routing sentinel', questionIntent: context.questionIntent });
      expect(text).toBe(stableV5ScheduleQuestionText(purpose));
      expect(text).not.toMatch(/作業|学習タスク|schedulable_work|task identity|sentinel/u);
      const payload = JSON.parse(createWeeklyPlanningStableV5DialoguePrompt(context).userPrompt);
      expect(payload.applicationDecision.questionIntent).toEqual(context.questionIntent);
      expect(payload.request).toContain('Wording follows typed purpose, never raw text');
      expect(payload.request).toContain('confirm_existing_schedule=「どんな予定がありますか？」');
      expect(payload.request).toContain('register_event=「どんな予定を入れたいですか？」');
      expect(payload.request).toContain('identify_study_work/identify_work_to_schedule=「何を勉強したいですか？」');
      expect(payload.request).toContain('日付/時刻/量の必須質問を保つ');
      expect(payload.request).toContain('会話に出さない');
      const legacy = JSON.parse(createWeeklyPlanningStableV5DialoguePrompt({ ...context, conversationArchitecture: 'legacy_v5' }).userPrompt);
      expect(legacy.request).not.toContain('Wording follows typed purpose');
      expect(legacy.applicationDecision).not.toHaveProperty('communication');
    });

  it.each(['missing_task_identity', 'all_requested_work_complete'] as const)('asks about established study in %s mode', mode => {
    const context = input(studyIntent(mode));
    expect(context.communication!.questionPurposes).toEqual([mode === 'missing_task_identity' ? 'identify_work_to_schedule' : 'find_more_work_or_constraints']);
    const text = fallbackTextForStableV5TypedIntent({ applicationText: '', questionIntent: context.questionIntent });
    expect(text).toContain('勉強');
    expect(text).not.toMatch(/作業|学習タスク|task identity|schedulable_work/u);
    const legacy = fallbackTextForStableV5TypedIntent({ applicationText: '', questionIntent: context.questionIntent, conversationArchitecture: 'legacy_v5' });
    expect(legacy).toContain('作業');
    const payload = JSON.parse(createWeeklyPlanningStableV5DialoguePrompt(context).userPrompt);
    expect(payload.request).toContain(mode === 'missing_task_identity'
      ? 'missing_task_identity=勉強したい内容' : 'all_requested_work_complete=完了済みとして');
    expect(payload.request).not.toContain(mode === 'missing_task_identity'
      ? 'all_requested_work_complete=' : 'missing_task_identity=');
    expect(payload.request).not.toContain('missing_task_identity=作業自体');
  });

  it('keeps category selection unchanged by a conflicting raw message', () => {
    const context = input({ kind: 'schedule_request', purpose: 'register_event', requestedInformation: ['schedule_request'] });
    const decisions = ['何を勉強したいですか？', 'どんな予定がありますか？'].map(currentUserMessage =>
      JSON.parse(createWeeklyPlanningStableV5DialoguePrompt({ ...context, currentUserMessage }).userPrompt).applicationDecision);
    expect(decisions[0]).toEqual(decisions[1]);
    expect(decisions[0].questionIntent.purpose).toBe('register_event');
  });

  it('keeps every schedule/study purpose inside the existing prompt budgets with applicable optional instructions', () => {
    const intents: WeeklyPlanningStableV5DialogueQuestionIntent[] = [
      ...(['confirm_existing_schedule', 'register_event', 'clarify_schedule_request'] as const)
        .map(purpose => ({ kind: 'schedule_request' as const, purpose, requestedInformation: ['schedule_request'] as const })),
      studyIntent('missing_task_identity'), studyIntent('all_requested_work_complete'),
    ];
    for (const questionIntent of intents) {
      for (const goal of ['ask_question', 'report_status', 'present_preview', 'explain_question', 'acknowledge_aside', 'resume_question', 'clarify_turn'] as const) {
        const context = input(questionIntent);
        const asksQuestion = ['ask_question', 'explain_question', 'resume_question', 'clarify_turn'].includes(goal);
        const prompt = createWeeklyPlanningStableV5DialoguePrompt({ ...context,
          actionKind: asksQuestion ? 'question' : goal === 'present_preview' ? 'preview_ready' : 'status',
          questionIntent: asksQuestion ? questionIntent : null,
          planningInformation: { selfRepair: { taskLabel: '数学', before: '20分', after: '30分' },
            removedThisTurn: [{ kind: 'task', taskLabel: '英語', label: '英語' }] },
          communication: { ...context.communication!, goal, askQuestion: asksQuestion,
            questionPurposes: asksQuestion ? context.communication!.questionPurposes : [],
            statusReason: goal === 'report_status' ? 'fixed_event_manual_entry' : null,
            planningDetailsNotApplied: true, consultationDeferred: true,
            consultation: { mode: 'advisory_only', assessmentScope: 'accepted_plan_only',
              feasibility: { status: 'not_evaluated', reason: 'no_schedulable_work' },
              missingQuestionCodes: [], workEstimates: [], dailyLimits: [], nextAction: 'clarify_planning_details' },
            previewDisclosure: goal === 'present_preview' ? { omittedWork: [{ label: '英語', extent: 'all' }] } : null,
            ...(goal === 'present_preview' ? {
              previewConstraintSatisfaction: [{ sourceFactId: 'p', taskId: 't', taskLabel: '数学', kind: 'preferred_window' as const, status: 'not_satisfied' as const }],
              allocationBreakdown: { estimatedMinutes: 60, calibratedMinutes: 60, bufferedMinutes: 66, allocatedMinutes: 70, marginMinutes: 10, reasons: ['estimate_margin' as const] },
            } : {}),
          },
        });
        const payload = JSON.parse(prompt.userPrompt);
        expect(new TextEncoder().encode(payload.request).byteLength, `${questionIntent.kind}/${goal}`).toBeLessThanOrEqual(4000);
        expect(new TextEncoder().encode(prompt.systemPrompt).byteLength).toBeLessThanOrEqual(900);
      }
    }
  });

  it.each(['fixed_event_manual_entry', 'no_additional_work'] as const)('does not reopen a question for terminal %s', statusReason => {
    const context = communicationContextForStableV5Dialogue({ outcome: undefined,
      facts: { statusReason, upcomingQuestionCodes: [], planningDetailsNotApplied: false, previewDisclosure: null },
      actionKind: 'status', questionCode: null, questionIntent: null });
    const text = composeWeeklyPlanningInteractionFallbackText({ communication: context,
      questionText: '質問を再提示するsentinel', questionCode: null, previewCount: 0,
      previewPromotionControlLabel: null, groundingNote: '' });
    expect(context.askQuestion).toBe(false);
    expect(text).not.toMatch(/作業|学習タスク|sentinel|[?？]|(?:登録|保存)しました/u);
    expect(text.includes('予定を追加')).toBe(statusReason === 'fixed_event_manual_entry');
  });

  it('keeps a label-free omission disclosure ordinary', () => {
    expect(weeklyPlanningPreviewOmissionDisclosureText([])).not.toMatch(/作業|学習タスク|タスク/u);
  });

  it.each(['study', 'non_study'] as const)('keeps the exact %s progress question through renderer fallback and provider recovery', async category => {
    const text = category === 'study' ? '数学を勉強したい' : '発表準備を進めたい';
    const task = { ...eventStudyTask(), category, title: category === 'study' ? '数学' : '発表準備',
      study: category === 'study' ? eventStudyTask().study : null, workloads: [], sourceText: text };
    let recovering = false;
    provider = installScriptedWeeklyPlanningProvider(call => {
      if (call.kind === 'renderer') return 'invalid renderer fixture';
      if (recovering) return { failure: 'http', status: 503 };
      return JSON.stringify(eventDocument({ tasks: [task], conversationActs: [] }));
    });
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', now: () => '2026-10-07T00:00:00.000Z' });
    const first = await conversation.submit(text);
    expect(first.result?.failure, JSON.stringify(first.debugTrace)).toBeUndefined();
    expect(first.result?.responseSource).toBe('deterministic_fallback');
    const context = first.result!.state.lastQuestionContext!;
    expect(context.topicId).toBe(conversation.graph()!.tasks[0].id);
    const decision = first.calls.find(call => call.kind === 'renderer')!.payload!.applicationDecision as Record<string, unknown>;
    expect(decision.questionIntent).toMatchObject({ kind: 'schedulable_work_detail', mode: 'existing_target_progress', targetFactId: context.topicId });
    expect((decision.communication as Record<string, unknown>).questionPurposes).toEqual(['skip_already_finished_work']);
    expect((decision.communication as Record<string, unknown>).scheduleIntent)
      .toBe(category === 'study' ? 'identify_study_work' : undefined);
    expect(first.result!.message).not.toMatch(/作業|学習タスク|どんな予定/u);
    const graphBefore = structuredClone(conversation.graph());
    recovering = true;
    const recovery = await conversation.submit('もう少し説明したい');
    expect(recovery.result?.interactionOutcome).toMatchObject({ kind: 'recover', failure: 'provider', representedQuestion: true });
    expect(recovery.result?.state.lastQuestionContext?.topicId).toBe(context.topicId);
    expect(conversation.graph()).toEqual(graphBefore);
    expect(recovery.result?.message).not.toMatch(/作業|学習タスク|どんな予定/u);
  });

  it('reconstructs a general schedule invitation when recovery has no communication facts', async () => {
    let recovering = false;
    provider = installScriptedWeeklyPlanningProvider(call => {
      if (call.kind === 'renderer') return 'invalid renderer fixture';
      if (recovering) return { failure: 'http', status: 503 };
      return JSON.stringify(eventDocument({ planningIntent: 'create_plan', planningWindow: {
        localId: 'window', kind: 'relative_day', value: 'today', start: null, end: null, sourceText: '今日',
      }, conversationActs: [] }));
    });
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', now: () => '2026-10-07T00:00:00.000Z' });
    const first = await conversation.submit('今日の予定を立てたい');
    expect(first.result?.state.lastQuestionContext?.targetSlot).toBe('stable_v5:missing_schedulable_work');
    expect(first.result?.message).not.toMatch(/作業|学習タスク|勉強/u);
    recovering = true;
    const recovery = await conversation.submit('希望がある');
    expect(recovery.result?.interactionOutcome).toMatchObject({ kind: 'recover', failure: 'provider', representedQuestion: true });
    expect(recovery.result?.message).not.toMatch(/作業|学習タスク|勉強/u);
    expect(recovery.result?.state.shouldSavePlan).not.toBe(true);
  });
});
