import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays } from './date';
import { buildStudyStreakModel, nextAutomaticStudyRestDate, studyRestDayBlockReason, type StudyStreakInput } from './studyStreak';
import { plan as makePlan } from '../repositories/localPersistenceConcurrency.testUtils';
import type { Actual } from '../types/domain';

const { normalize } = vi.hoisted(() => ({ normalize: vi.fn() }));
vi.mock('./studyRecords', async (importOriginal) => {
  const original = await importOriginal<typeof import('./studyRecords')>();
  return { ...original, normalizeStudyRecordsForDisplay: normalize.mockImplementation(original.normalizeStudyRecordsForDisplay) };
});

const actual = (date: string, overrides: Partial<Actual> = {}): Actual => ({
  id: date, userId: 'owner', planId: null, occurrenceDate: date,
  actualStartTime: '09:00', actualEndTime: '09:10', subject: '数学', note: '',
  updatedAt: '2026-10-16T00:00:00Z', ...overrides,
});
const days = (start: string, count: number) => Array.from({ length: count }, (_, i) => actual(addDays(start, i)));
const input = (overrides: Partial<StudyStreakInput> = {}): StudyStreakInput => ({
  userId: 'owner', plans: [], monthEvents: [], actuals: [], today: '2026-10-16', historyComplete: true, ...overrides,
});

// Preserve the pre-optimization selector as an independent semantic oracle.
// The public per-day guard continues to build and validate complete models.
function referenceNext(source: StudyStreakInput): string | null {
  if (!source.historyComplete || !Array.isArray(source.monthEvents)) return null;
  const model = buildStudyStreakModel(source);
  const occupied = new Set([...model.studyDates, ...(source.restDays ?? []).map(day => day.date)]);
  const candidates = [...new Set([...model.studyDates, ...model.protectedDates].map(date => addDays(date, 1)))]
    .filter(date => date < source.today && !occupied.has(date)).sort();
  return candidates.find(date => studyRestDayBlockReason(source, date) === null) ?? null;
}

beforeEach(() => { normalize.mockClear(); });

describe('automatic rest calculation work and equivalence', () => {
  it('normalizes a sparse no-award history only once, independent of the number of gaps', () => {
    const source = input({ actuals: Array.from({ length: 365 }, (_, i) => actual(addDays('2024-01-01', i * 2))) });
    expect(nextAutomaticStudyRestDate(source)).toBeNull();
    expect(normalize).toHaveBeenCalledTimes(1);
  });

  it('reuses normalization while scanning old ineligible gaps before an eligible earned ticket', () => {
    const source = input({ actuals: [
      ...Array.from({ length: 30 }, (_, i) => actual(addDays('2024-01-01', i * 2))),
      ...days('2026-10-01', 7),
    ] });
    expect(nextAutomaticStudyRestDate(source)).toBe('2026-10-08');
    expect(normalize).toHaveBeenCalledTimes(1);
  });

  it('does not confuse a depleted current balance with having never earned a ticket', () => {
    const source = input({ actuals: [...days('2026-09-01', 8), ...days('2026-09-10', 6)],
      restDays: [{ date: '2026-09-16' }] });
    expect(buildStudyStreakModel(source)).toMatchObject({ earnedTickets: 1, availableTickets: 0, protectedDates: ['2026-09-16'] });
    expect(referenceNext(source)).toBe('2026-09-09');
    expect(nextAutomaticStudyRestDate(source)).toBe('2026-09-09');
    const protectedModel = buildStudyStreakModel({ ...source, restDays: [...source.restDays!, { date: '2026-09-09' }] });
    expect(protectedModel).toMatchObject({ earnedTickets: 2, protectedDates: ['2026-09-09', '2026-09-16'] });
  });

  it('matches every 10-day study pattern with empty, duplicate, and historical manual rest records', () => {
    for (let pattern = 0; pattern < 1024; pattern++) {
      const actuals = Array.from({ length: 10 }, (_, day) => (pattern & (1 << day)) ? actual(addDays('2024-02-23', day)) : null)
        .filter((row): row is Actual => row !== null);
      for (const restDays of [[], [{ date: '2024-02-29' }, { date: '2024-03-02' }, { date: '2024-02-29' }]]) {
        const source = input({ actuals, restDays, today: '2024-03-06' });
        expect(nextAutomaticStudyRestDate(source), JSON.stringify({ pattern, restDays })).toBe(referenceNext(source));
      }
    }
  });

  it('matches generated histories with corrections, mixed owners, source types, and complete protection lifecycles', () => {
    let seed = 542;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
    const plan = makePlan({ id: 'general', userId: 'owner', title: 'School', subject: '', date: '2024-12-15',
      startTime: '09:00', endTime: '09:10', type: 'other', repeat: 'daily' });
    for (let run = 0; run < 120; run++) {
      const actuals: Actual[] = [];
      const restDays: { date: string }[] = [];
      for (let day = 0; day < 42; day++) {
        const date = addDays('2024-12-15', day);
        if (random() < 0.84) {
          actuals.push(actual(date, { userId: random() < 0.08 ? 'foreign' : 'owner',
            planId: random() < 0.12 ? plan.id : null, actualEndTime: random() < 0.08 ? '09:00' : '09:10' }));
        }
        if (random() < 0.16) restDays.push({ date });
      }
      actuals.push(actual('2025-02-30'), actual('2027-01-01'), actual('2024-12-16', { id: 'duplicate', planId: plan.id, actualEndTime: '09:00' }));
      const source = input({ actuals, restDays, plans: [plan], today: '2025-02-01' });
      // Compare every next selection until all available automatic steps settle.
      for (let step = 0; step < 43; step++) {
        const unchanged = JSON.stringify(source);
        const expected = referenceNext(source);
        expect(nextAutomaticStudyRestDate(source), `run ${run}, step ${step}`).toBe(expected);
        expect(JSON.stringify(source)).toBe(unchanged);
        if (!expected) break;
        source.restDays = [...source.restDays!, { date: expected }];
        expect(step).toBeLessThan(42);
      }
    }
  });

  it('does not process unavailable history or invent a missing MonthEvent authority', () => {
    expect(nextAutomaticStudyRestDate(input({ historyComplete: false }))).toBeNull();
    expect(nextAutomaticStudyRestDate(input({ monthEvents: undefined }))).toBeNull();
    expect(normalize).not.toHaveBeenCalled();
    expect(() => nextAutomaticStudyRestDate(input({ today: '2026-02-30' }))).toThrow();
  });
});
