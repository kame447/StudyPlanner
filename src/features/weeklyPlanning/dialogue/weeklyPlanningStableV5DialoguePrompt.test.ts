import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningStableV5DialogueRenderInput } from './weeklyPlanningStableV5DialogueContracts';
import {
  createWeeklyPlanningStableV5DialoguePrompt,
  createWeeklyPlanningStableV5DialogueStateSummary,
} from './weeklyPlanningStableV5DialoguePrompt';

function input(): WeeklyPlanningStableV5DialogueRenderInput {
  return {
    actionId: 'stable-v5:request-1:quantity_role_unresolved',
    currentUserMessage: 'どういうこと？',
    recentConversation: [
      { role: 'user', content: '院試は2分野それぞれ3時間やりたい' },
      { role: 'assistant', content: '第2分野の3時間は今回進めたい量ですか？' },
    ],
    planningInformation: {
      tasks: [{ title: '院試', category: 'study' }],
      workloads: [
        { taskId: 'task-1', amount: 3, unitLabel: '時間', quantityRole: 'target' },
        { taskId: 'task-2', amount: 3, unitLabel: '時間', quantityRole: 'unknown' },
      ],
      groundingRecords: [{
        targetFactId: 'window-1',
        interpretationKind: 'relative_date_resolution',
        status: 'proposed',
        sourceExpression: '来週',
        startDate: '2026-08-03',
        endDate: '2026-08-09',
      }],
      availabilityDeclarations: [
        { id: 'a1', resolutionStatus: 'unresolved', kind: 'unavailable', startTime: '14:30', endTime: '20:00' },
      ],
      uncertainties: [{ field: 'work_breakdown', sourceText: '2分野' }],
    },
    currentTurnGrounding: {
      mode: 'required_before_resume',
      acceptedFacts: [{
        factId: 'a1',
        kind: 'availability_declaration',
        sourceText: '14:30から20:00はバイト',
        data: { kind: 'unavailable', startTime: '14:30', endTime: '20:00' },
      }],
    },
    actionKind: 'question',
    questionCode: 'quantity_role_unresolved',
    questionIntent: {
      kind: 'resolution_question',
      resolutionKind: 'quantity_role',
      targetFactId: null,
      requestedInformation: ['quantity_role'],
      allowedChoices: ['plan_target_amount', 'remaining_total_amount'],
      knownAmount: 3,
      knownUnitLabel: '時間',
      ambiguityField: null,
      ambiguityReason: null,
    },
    requiredLabels: ['院試の第2分野'],
    fallbackText: '院試の第2分野の量は、今回進めたい量ですか？',
    previewCount: 0,
  };
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

describe('Stable V5 dialogue prompt', () => {
  it('separates accepted facts from downstream resolution-pending items', () => {
    const summary = createWeeklyPlanningStableV5DialogueStateSummary(input()) as {
      acceptedFacts: Record<string, unknown>;
      groundingContext: Array<Record<string, unknown>>;
      resolutionPendingItems: Array<Record<string, unknown>>;
    };

    expect(summary.acceptedFacts.workloads).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: 'task-1', quantityRole: 'target' }),
      expect.objectContaining({ taskId: 'task-2', quantityRole: 'unknown' }),
    ]));
    expect(summary.acceptedFacts.availabilityDeclarations).toEqual([
      expect.objectContaining({ id: 'a1', resolutionStatus: 'unresolved' }),
    ]);
    expect(summary.acceptedFacts).not.toHaveProperty('uncertainties');
    expect(summary.acceptedFacts).not.toHaveProperty('groundingRecords');
    expect(summary.groundingContext).toEqual([
      expect.objectContaining({ status: 'proposed', sourceExpression: '来週' }),
    ]);
    expect(summary.resolutionPendingItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'work_breakdown' }),
      expect.objectContaining({ kind: 'workload_field', taskId: 'task-2' }),
      expect.objectContaining({ sourceCollection: 'availabilityDeclarations', id: 'a1' }),
    ]));
  });

  it('keeps typed application decisions and current-turn grounding explicit', () => {
    const prompt = createWeeklyPlanningStableV5DialoguePrompt(input());
    const payload = JSON.parse(prompt.userPrompt) as Record<string, unknown>;
    const request = String((payload as { request: string }).request);

    // Interaction (default): a conversation partner who answers the user's act first and
    // never reports the app's internals. Legacy keeps the pre-#488 wording (asserted below).
    expect(prompt.systemPrompt).toContain('最初の一文で、ユーザーがいま言ったことに直接応えてください');
    expect(prompt.systemPrompt).toContain('アプリ内部の仕組みや処理');
    expect(createWeeklyPlanningStableV5DialoguePrompt({ ...input(), conversationArchitecture: 'legacy_v5' })
      .systemPrompt).toContain('継続中の相談');
    expect(request).toContain('currentTurnGrounding.acceptedFacts');
    expect(request).toContain('required_before_resume');
    expect(request).toContain('requestedInformation');
    expect(request).toContain('remaining_total_amount');
    expect(request).toContain('task_relation');
    expect(payload).toMatchObject({
      currentTurnGrounding: {
        mode: 'required_before_resume',
        acceptedFacts: [expect.objectContaining({ factId: 'a1' })],
      },
      applicationDecision: {
        actionKind: 'question',
        questionCode: 'quantity_role_unresolved',
        questionIntent: expect.objectContaining({
          kind: 'resolution_question',
          resolutionKind: 'quantity_role',
        }),
      },
    });
    expect(prompt.userPrompt).not.toContain('referenceResponse');
    expect(prompt.userPrompt).not.toContain(input().fallbackText);
  });

  it('allows semantic invariants to take precedence over the old compactness target', () => {
    const prompt = createWeeklyPlanningStableV5DialoguePrompt(input());
    const payload = JSON.parse(prompt.userPrompt) as { request: string };

    expect(bytes(prompt.systemPrompt)).toBeLessThanOrEqual(900);
    // Keep a material-growth guard, but do not force semantic contracts out of
    // the renderer merely to satisfy PR #130's former compactness target.
    expect(bytes(payload.request)).toBeLessThanOrEqual(4000);
  });

  it('stays inside the size guard for every interaction goal with every optional instruction', () => {
    const goals = ['ask_question', 'report_status', 'present_preview', 'explain_question',
      'acknowledge_aside', 'resume_question', 'clarify_turn'] as const;
    for (const goal of goals) {
      const prompt = createWeeklyPlanningStableV5DialoguePrompt({
        ...input(),
        planningInformation: { ...input().planningInformation, selfRepair: { taskLabel: '院試', before: '3時間', after: '2時間' } },
        communication: {
          goal,
          questionPurposes: ['tell_plan_amount_from_remaining_total'],
          askQuestion: true,
          laterNeeds: ['estimate_time_to_fit_available_time', 'set_planning_period', 'know_exact_time_range'],
          statusReason: goal === 'report_status' ? 'ready_to_create_preview' : null,
          planningDetailsNotApplied: true,
          consultationDeferred: true,
          previewDisclosure: goal === 'present_preview' ? { omittedWorkLabels: ['英語', '物理'] } : null,
        },
      });
      const payload = JSON.parse(prompt.userPrompt) as { request: string };
      expect(bytes(prompt.systemPrompt)).toBeLessThanOrEqual(900);
      expect(bytes(payload.request)).toBeLessThanOrEqual(4000);
    }
  });

  it('lets the acknowledgement of this turn\'s new details come before an explanation (mixed turn)', () => {
    const prompt = createWeeklyPlanningStableV5DialoguePrompt({
      ...input(),
      communication: {
        goal: 'explain_question',
        questionPurposes: ['tell_plan_amount_from_remaining_total'],
        askQuestion: true,
        laterNeeds: [],
        statusReason: null,
        planningDetailsNotApplied: false,
        consultationDeferred: false,
        previewDisclosure: null,
      },
    });
    const { request } = JSON.parse(prompt.userPrompt) as { request: string };
    // The explanation instruction defers to the required acknowledgement instead of competing
    // with it for the opening of the reply (the validator requires the reply to start with it).
    const explanation = request.slice(request.indexOf('goal=explain_question'));
    expect(explanation.slice(0, explanation.indexOf('なぜその情報が必要か'))).toContain('required_before_resume');
  });
});
