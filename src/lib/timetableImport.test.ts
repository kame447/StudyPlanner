import { describe, expect, it } from 'vitest';
import type { ScheduleTemplate } from '../types/domain';
import {
  buildTimetableImportCandidates,
  createPlanDraftFromTimetableImportCandidate,
} from './timetableImport';

function template(
  overrides: Partial<ScheduleTemplate> & Pick<ScheduleTemplate, 'id' | 'title' | 'periodNumber'>,
): ScheduleTemplate {
  const { id, title, periodNumber, ...rest } = overrides;

  return {
    id,
    userId: 'user-1',
    title,
    subject: '英語',
    type: 'school-event',
    weekday: 'mon',
    startTime: '10:20',
    endTime: '11:50',
    termId: 'term-1',
    periodNumber,
    classroom: '共21',
    memo: '',
    active: true,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...rest,
  };
}

describe('buildTimetableImportCandidates', () => {
  it('combines two consecutive templates with the same trimmed title', () => {
    const candidates = buildTimetableImportCandidates({
      date: '2026-04-20',
      weekday: 'mon',
      termId: 'term-1',
      templates: [
        template({ id: 'template-2', title: ' 英語 ', periodNumber: 2 }),
        template({
          id: 'template-3',
          title: '英語',
          periodNumber: 3,
          startTime: '12:45',
          endTime: '14:15',
          classroom: '共22',
        }),
      ],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      title: '英語',
      startTime: '10:20',
      endTime: '14:15',
      periodLabel: '2〜3限',
      sourceId: 'timetable:term-1:2026-04-20:mon:2-3:%E8%8B%B1%E8%AA%9E',
      isGrouped: true,
    });
    expect(candidates[0].memo).toContain('教室: 2限 共21 / 3限 共22');
  });

  it('combines three or more consecutive templates into one candidate', () => {
    const candidates = buildTimetableImportCandidates({
      date: '2026-04-21',
      weekday: 'tue',
      termId: 'term-1',
      templates: [
        template({
          id: 'template-1',
          title: '実験',
          weekday: 'tue',
          periodNumber: 1,
          startTime: '08:40',
          endTime: '10:10',
        }),
        template({
          id: 'template-2',
          title: '実験',
          weekday: 'tue',
          periodNumber: 2,
          startTime: '10:20',
          endTime: '11:50',
        }),
        template({
          id: 'template-3',
          title: '実験',
          weekday: 'tue',
          periodNumber: 3,
          startTime: '12:45',
          endTime: '14:15',
        }),
      ],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      title: '実験',
      startTime: '08:40',
      endTime: '14:15',
      periodLabel: '1〜3限',
      isGrouped: true,
    });
  });

  it('keeps matching titles separate when period numbers are not consecutive', () => {
    const candidates = buildTimetableImportCandidates({
      date: '2026-04-20',
      weekday: 'mon',
      termId: 'term-1',
      templates: [
        template({
          id: 'template-1',
          title: '英語',
          periodNumber: 1,
          startTime: '08:40',
          endTime: '10:10',
        }),
        template({
          id: 'template-4',
          title: '英語',
          periodNumber: 4,
          startTime: '14:25',
          endTime: '15:55',
        }),
      ],
    });

    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.sourceId)).toEqual([
      'template-1',
      'template-4',
    ]);
    expect(candidates.every((candidate) => candidate.isGrouped)).toBe(false);
  });

  it('builds a timetable PlanDraft from the grouped candidate source id', () => {
    const [candidate] = buildTimetableImportCandidates({
      date: '2026-04-20',
      weekday: 'mon',
      termId: 'term-1',
      templates: [
        template({ id: 'template-2', title: '英語', periodNumber: 2 }),
        template({
          id: 'template-3',
          title: '英語',
          periodNumber: 3,
          startTime: '12:45',
          endTime: '14:15',
        }),
      ],
    });

    const draft = createPlanDraftFromTimetableImportCandidate(
      candidate,
      'user-1',
      '2026-04-20',
    );

    expect(draft).toMatchObject({
      title: '英語',
      subject: '英語',
      date: '2026-04-20',
      startTime: '10:20',
      endTime: '14:15',
      repeat: 'none',
      recurrenceRules: [],
      sourceType: 'timetable',
      sourceId: 'timetable:term-1:2026-04-20:mon:2-3:%E8%8B%B1%E8%AA%9E',
    });
  });
});
