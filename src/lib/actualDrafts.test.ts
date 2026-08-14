import { describe, expect, it } from 'vitest';
import {
  createActualDraftForPlan,
  createRelinkCandidateActual,
  resolveActualAlignedToPlan,
} from './actualDrafts';
import type { Actual, Plan } from '../types/domain';

const plan: Plan = {
  id: 'plan-1',
  seriesId: 'plan-1',
  userId: 'user-1',
  title: '数学ワーク',
  subject: '数学',
  date: '2026-08-18',
  startTime: '19:00',
  endTime: '20:00',
  repeat: 'none',
  repeatUntil: null,
  excludedDates: [],
  recurrenceRules: [],
  type: 'study',
  memo: '',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  materialId: 'material-1',
  materialName: '数学問題集',
};

const actual: Actual = {
  id: 'actual-1',
  userId: 'user-1',
  planId: 'plan-1',
  occurrenceDate: '2026-08-18',
  actualStartTime: '19:10',
  actualEndTime: '20:10',
  title: '数学ワーク',
  subject: '数学',
  note: '復習まで実施',
  updatedAt: '2026-08-18T20:10:00.000Z',
  materialId: 'material-1',
  materialName: '数学問題集',
};

describe('actualDrafts', () => {
  it('builds a plan-linked draft from the plan when no actual exists', () => {
    expect(createActualDraftForPlan(plan)).toEqual({
      userId: 'user-1',
      planId: 'plan-1',
      occurrenceDate: '2026-08-18',
      actualStartTime: '19:00',
      actualEndTime: '20:00',
      title: '数学ワーク',
      subject: '数学',
      isAlignedToPlan: true,
      note: '',
      materialId: 'material-1',
      materialName: '数学問題集',
    });
  });

  it('uses explicit alignment metadata when present', () => {
    expect(
      resolveActualAlignedToPlan(plan, {
        ...actual,
        title: '別の内容',
        isAlignedToPlan: true,
      }),
    ).toBe(true);
  });

  it('infers alignment for legacy actuals without explicit metadata', () => {
    expect(resolveActualAlignedToPlan(plan, actual)).toBe(true);
    expect(
      resolveActualAlignedToPlan(plan, {
        ...actual,
        title: '英語レポート',
      }),
    ).toBe(false);
  });

  it('preserves actual values when rebuilding an existing draft', () => {
    expect(createActualDraftForPlan(plan, actual)).toMatchObject({
      occurrenceDate: '2026-08-18',
      actualStartTime: '19:10',
      actualEndTime: '20:10',
      title: '数学ワーク',
      subject: '数学',
      note: '復習まで実施',
      materialId: 'material-1',
      materialName: '数学問題集',
    });
  });

  it('creates a relink candidate from the edited draft without mutating identity', () => {
    const draft = {
      ...createActualDraftForPlan(plan, actual),
      occurrenceDate: '2026-08-19',
      actualStartTime: '18:00',
      actualEndTime: '19:00',
      title: '数学復習',
      subject: '数学',
      note: '日付変更',
    };

    expect(createRelinkCandidateActual(actual, draft)).toMatchObject({
      id: 'actual-1',
      occurrenceDate: '2026-08-19',
      actualStartTime: '18:00',
      actualEndTime: '19:00',
      title: '数学復習',
      subject: '数学',
      isAlignedToPlan: false,
      note: '日付変更',
    });
  });
});
