import { describe, expect, it } from 'vitest';
import type { PlanDraft } from '../../types/domain';
import {
  createPlanDraftFromWeeklyDraftBlock,
  createWeeklyDraftBlockFromPlanDraft,
} from './weeklyPlanningTransforms';

function planDraft(overrides: Partial<PlanDraft> = {}): PlanDraft {
  return {
    userId: 'user-1',
    title: '英語課題',
    subject: '英語',
    date: '2026-06-22',
    startTime: '19:00',
    endTime: '20:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'study',
    memo: 'unit 3',
    sourceType: 'manual',
    sourceId: null,
    materialId: 'material-1',
    materialName: '英語ワーク',
    ...overrides,
  };
}

describe('weeklyPlanningTransforms', () => {
  it('keeps weekly drafts separate from saved plan ids and occurrence keys', () => {
    const block = createWeeklyDraftBlockFromPlanDraft(planDraft());

    expect(block.id).toMatch(/^weekly-draft-/);
    expect(block.status).toBe('draft');
    expect(block.source).toBe('ai');
    expect(block.userEdited).toBe(false);
    expect('planId' in block).toBe(false);
    expect('occurrenceKey' in block).toBe(false);
  });

  it('converts a weekly draft to a normal one-off PlanDraft on approval', () => {
    const block = createWeeklyDraftBlockFromPlanDraft(planDraft());
    const savedDraft = createPlanDraftFromWeeklyDraftBlock(block, 'user-1');

    expect(savedDraft).toMatchObject({
      userId: 'user-1',
      title: '英語課題',
      subject: '英語',
      date: '2026-06-22',
      startTime: '19:00',
      endTime: '20:00',
      repeat: 'none',
      type: 'study',
      materialId: 'material-1',
      materialName: '英語ワーク',
    });
    expect(savedDraft.recurrenceRules).toEqual([]);
  });
});
