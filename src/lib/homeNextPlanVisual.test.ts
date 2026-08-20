import { describe, expect, it } from 'vitest';
import type { Plan, StudyMaterial } from '../types/domain';
import { resolveHomeNextPlanPresentation } from './homeNextPlanVisual';

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    seriesId: 'plan-1',
    userId: 'user-1',
    title: 'アルゴリズム演習',
    subject: '情報科学',
    date: '2026-08-20',
    startTime: '13:30',
    endTime: '15:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'study',
    memo: '',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  };
}

const materials: StudyMaterial[] = [
  {
    id: 'material-1',
    userId: 'user-1',
    name: 'アルゴリズム演習 第3章',
    subjectId: 'subject-1',
    subjectName: '情報科学',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  },
];

describe('resolveHomeNextPlanPresentation', () => {
  it('keeps self-study copy and resolves the selected material', () => {
    const presentation = resolveHomeNextPlanPresentation(
      makePlan({ materialId: 'material-1' }),
      materials,
    );

    expect(presentation.visual.kind).toBe('study');
    expect(presentation.semanticKind).toBe('study');
    expect(presentation.detailLabel).toBe('教材');
    expect(presentation.detailValue).toBe('アルゴリズム演習 第3章');
    expect(presentation.durationLabel).toBe('予定学習時間');
    expect(presentation.actionLabel).toBe('学習を開始する');
  });

  it('uses class copy for timetable plans even when their PlanType is study', () => {
    const presentation = resolveHomeNextPlanPresentation(
      makePlan({
        title: '情報資源総論',
        subject: '情報資源総論',
        sourceType: 'timetable',
      }),
      materials,
    );

    expect(presentation.visual.kind).toBe('class');
    expect(presentation.semanticKind).toBe('class');
    expect(presentation.detailLabel).toBe('科目');
    expect(presentation.detailValue).toBe('情報資源総論');
    expect(presentation.durationLabel).toBe('授業時間');
    expect(presentation.actionLabel).toBe('授業を確認する');
  });

  it('keeps mock exams visually study-like while using exam-specific copy', () => {
    const presentation = resolveHomeNextPlanPresentation(
      makePlan({ type: 'mock-exam', title: '基本情報 模試' }),
      materials,
    );

    expect(presentation.visual.kind).toBe('study');
    expect(presentation.semanticKind).toBe('mock-exam');
    expect(presentation.detailLabel).toBe('科目');
    expect(presentation.durationLabel).toBe('試験時間');
    expect(presentation.actionLabel).toBe('模試を確認する');
  });

  it('uses generic schedule copy for non-study plans', () => {
    const presentation = resolveHomeNextPlanPresentation(
      makePlan({ type: 'school-event', title: '大学祭' }),
      materials,
    );

    expect(presentation.visual.kind).toBe('other');
    expect(presentation.semanticKind).toBe('other');
    expect(presentation.detailLabel).toBe('カテゴリ');
    expect(presentation.detailValue).toBe('学校行事');
    expect(presentation.durationLabel).toBe('予定時間');
    expect(presentation.actionLabel).toBe('予定を確認する');
  });

  it('uses the user-entered subject as the category for type other', () => {
    const presentation = resolveHomeNextPlanPresentation(
      makePlan({ type: 'other', title: '部屋の掃除', subject: '生活' }),
      materials,
    );

    expect(presentation.visual.kind).toBe('other');
    expect(presentation.detailValue).toBe('生活');
  });
});
