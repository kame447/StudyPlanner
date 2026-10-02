import { describe, expect, it } from 'vitest';
import type { PlanDraft, PlanType } from '../../../types/domain';
import type { WeeklyPlanDraftBlock } from '../types';
import { createPlanDraftFromWeeklyDraftBlock } from './weeklyPlanningDraftConversion';

function draftBlock(overrides: Partial<WeeklyPlanDraftBlock> = {}): WeeklyPlanDraftBlock {
  return {
    id: 'weekly-draft-1',
    userId: 'preview-user',
    date: '2026-10-02',
    startTime: '23:00',
    endTime: '24:00',
    title: '  英語の復習  ',
    subject: '  英語  ',
    type: 'study',
    label: '  今週の学習  ',
    materialId: 'material-1',
    materialName: '  英語ワーク  ',
    memo: '  第1章\n第2章  ',
    source: 'ai',
    status: 'draft',
    userEdited: true,
    behaviorMetadata: {
      conversationId: 'conversation-1',
      stateRevision: 3,
      sourceFactRefs: ['fact-1'],
      usedAssumptionProposalRefs: [],
      taskRef: 'task-1',
      opportunityTags: [],
      reasoningKey: 'stable-v5-explicit-duration',
      compatibility: {
        workItemSemantic: 'generic_semantic_task',
        schedulerInputSource: 'stable_v5_generic_scheduler_input',
        candidateSource: 'stable_v5',
      },
    },
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    ...overrides,
  };
}

const expectedDraft: PlanDraft = {
  userId: 'saving-user',
  title: '英語の復習',
  subject: '英語',
  date: '2026-10-02',
  startTime: '23:00',
  endTime: '24:00',
  repeat: 'none',
  repeatUntil: null,
  excludedDates: [],
  recurrenceRules: [],
  type: 'study',
  memo: '第1章\n第2章',
  sourceType: 'manual',
  sourceId: null,
  materialId: 'material-1',
  materialName: '英語ワーク',
};

describe('weekly planning draft conversion', () => {
  it('preserves the exact one-off draft output and uses the supplied saving user', () => {
    const block = draftBlock();
    const original = structuredClone(block);

    expect(createPlanDraftFromWeeklyDraftBlock(Object.freeze(block), 'saving-user'))
      .toStrictEqual(expectedDraft);
    expect(block).toStrictEqual(original);
  });

  it.each([
    { label: '  ラベル  ', materialName: '  教材  ', subject: '  ', title: '\t', expectedTitle: 'ラベル', expectedSubject: 'ラベル' },
    { label: '  ', materialName: '  教材  ', subject: '  ', title: '\t', expectedTitle: '教材', expectedSubject: '教材' },
    { label: '  ', materialName: '  ', subject: '  数学  ', title: '\t', expectedTitle: '数学', expectedSubject: '数学' },
    { label: '  ', materialName: undefined, subject: '  ', title: '  演習  ', expectedTitle: '演習', expectedSubject: '演習' },
    { label: '  ', materialName: undefined, subject: '  ', title: '\t', expectedTitle: '学習予定', expectedSubject: '学習予定' },
    { label: '  ラベル  ', materialName: '  教材  ', subject: '  数学  ', title: '\t', expectedTitle: 'ラベル', expectedSubject: '数学' },
    { label: '  ラベル  ', materialName: '  教材  ', subject: '  ', title: '  演習  ', expectedTitle: '演習', expectedSubject: 'ラベル' },
    { label: '  ', materialName: '  教材  ', subject: '  数学  ', title: '\t', expectedTitle: '教材', expectedSubject: '数学' },
  ])('fills blank fields using label/material/subject/title/default precedence: $expectedTitle / $expectedSubject', ({
    label, materialName, subject, title, expectedTitle, expectedSubject,
  }) => {
    expect(createPlanDraftFromWeeklyDraftBlock(draftBlock({
      label, materialName, subject, title,
    }), 'saving-user')).toStrictEqual({
      ...expectedDraft,
      title: expectedTitle,
      subject: expectedSubject,
      materialName: materialName?.trim() ?? '',
    });
  });

  it.each([
    { materialId: undefined, materialName: undefined, memo: undefined, expectedMaterialId: null },
    { materialId: null, materialName: ' \t ', memo: ' \n ', expectedMaterialId: null },
    { materialId: '', materialName: '', memo: '', expectedMaterialId: '' },
  ])('normalizes absent or blank optional fields without inventing a material', ({
    materialId, materialName, memo, expectedMaterialId,
  }) => {
    expect(createPlanDraftFromWeeklyDraftBlock(draftBlock({
      materialId, materialName, memo,
    }), 'saving-user')).toStrictEqual({
      ...expectedDraft,
      materialId: expectedMaterialId,
      materialName: '',
      memo: '',
    });
  });

  it.each<PlanType>([
    'study', 'mock-exam', 'school-event', 'cram-school', 'deadline', 'other',
  ])('preserves the structured plan type %s', (type) => {
    expect(createPlanDraftFromWeeklyDraftBlock(draftBlock({ type }), 'saving-user'))
      .toStrictEqual({ ...expectedDraft, type });
  });

  it('allocates independent recurrence collections for each saved draft', () => {
    const block = draftBlock();
    const first = createPlanDraftFromWeeklyDraftBlock(block, 'saving-user');
    const second = createPlanDraftFromWeeklyDraftBlock(block, 'saving-user');

    expect(first.excludedDates).not.toBe(second.excludedDates);
    expect(first.recurrenceRules).not.toBe(second.recurrenceRules);
    first.excludedDates.push('2026-10-02');
    expect(second).toStrictEqual(expectedDraft);
  });
});
