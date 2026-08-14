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
      availabilityDeclarations: [
        { id: 'a1', resolutionStatus: 'resolved' },
        { id: 'a2', resolutionStatus: 'unresolved' },
      ],
      uncertainties: [{ field: 'work_breakdown', sourceText: '2分野' }],
    },
    actionKind: 'question',
    questionCode: 'quantity_role_unresolved',
    requiredLabels: ['院試の第2分野'],
    fallbackText: '院試の第2分野の量は、今回進めたい量ですか？',
    previewCount: 0,
  };
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

describe('Stable V5 dialogue prompt', () => {
  it('projects decided facts separately from unresolved items', () => {
    const summary = createWeeklyPlanningStableV5DialogueStateSummary(input()) as {
      decidedFacts: Record<string, unknown>;
      undecidedItems: Array<Record<string, unknown>>;
    };

    expect(summary.decidedFacts.workloads).toEqual([
      expect.objectContaining({ taskId: 'task-1', quantityRole: 'target' }),
    ]);
    expect(summary.decidedFacts.availabilityDeclarations).toEqual([
      expect.objectContaining({ id: 'a1', resolutionStatus: 'resolved' }),
    ]);
    expect(summary.decidedFacts).not.toHaveProperty('uncertainties');
    expect(summary.undecidedItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'work_breakdown' }),
      expect.objectContaining({ kind: 'workload_field', taskId: 'task-2' }),
      expect.objectContaining({ sourceCollection: 'availabilityDeclarations', id: 'a2' }),
    ]));
  });

  it('keeps the prompt focused on natural wording and typed application decisions', () => {
    const prompt = createWeeklyPlanningStableV5DialoguePrompt(input());
    const combined = `${prompt.systemPrompt}\n${prompt.userPrompt}`;
    const payload = JSON.parse(prompt.userPrompt) as Record<string, unknown>;

    expect(prompt.systemPrompt).toContain('入力にない具体情報は、例としても補わないでください');
    expect(combined.match(/入力にない/g)).toHaveLength(1);
    expect(prompt.systemPrompt).not.toContain('action識別子を変更しないでください');
    expect(prompt.systemPrompt).not.toContain('Do not add, remove, split, or merge questions');
    expect(prompt.systemPrompt).not.toContain('Preserve every string');
    expect(prompt.userPrompt).not.toContain('referenceResponse');
    expect(prompt.userPrompt).not.toContain(input().fallbackText);
    expect(prompt.userPrompt).not.toContain('未実行の作成・保存を完了したとは言わないでください');
    expect(payload).toMatchObject({
      actionId: input().actionId,
      currentUserMessage: input().currentUserMessage,
      planningStateSummary: expect.any(Object),
      applicationDecision: {
        actionKind: 'question',
        questionCode: 'quantity_role_unresolved',
        relevantLabels: ['院試の第2分野'],
        previewCount: 0,
      },
    });
    expect(payload).not.toHaveProperty('planningInformation');
  });

  it('locks the always-on renderer prose to a small budget', () => {
    const prompt = createWeeklyPlanningStableV5DialoguePrompt(input());
    const payload = JSON.parse(prompt.userPrompt) as { request: string };

    expect(bytes(prompt.systemPrompt)).toBeLessThanOrEqual(600);
    expect(bytes(payload.request)).toBeLessThanOrEqual(700);
  });
});
