import { describe, expect, it } from 'vitest';
import { buildDurationActuals, MAX_DURATION_ACTUAL_BATCH, type DurationActualInput } from './durationActuals';
import { createPlannerRepository } from '../repositories/plannerRepository';
import type { PlannerStorageGateway } from '../repositories/repositoryContracts';
import type { Actual } from '../types/domain';

const NOW = '2026-11-03T01:00:00.000Z';
const record = (over: Partial<DurationActualInput> = {}): DurationActualInput =>
  ({ id: 'wp-actual-c1-2026-10-26-math', occurrenceDate: '2026-10-26', subject: '数学', title: '数学', minutes: 60, ...over });

describe('buildDurationActuals', () => {
  it('builds time-only documents owned by the caller, with no clock times and no plan', () => {
    const [built] = buildDurationActuals('owner', [record()], NOW);
    expect(built).toEqual({ id: 'wp-actual-c1-2026-10-26-math', userId: 'owner', planId: null, occurrenceDate: '2026-10-26',
      actualDurationMinutes: 60, title: '数学', subject: '数学', isAlignedToPlan: false, note: '', updatedAt: NOW, materialId: null, materialName: '' });
    expect(built).not.toHaveProperty('actualStartTime');
    expect(built).not.toHaveProperty('actualEndTime');
  });

  it('is deterministic: the same input gives the same documents', () => {
    expect(buildDurationActuals('owner', [record()], NOW)).toEqual(buildDurationActuals('owner', [record()], NOW));
  });

  it.each([
    ['no owner', () => buildDurationActuals(' ', [record()], NOW)],
    ['no records', () => buildDurationActuals('owner', [], NOW)],
    ['too many records', () => buildDurationActuals('owner', Array.from({ length: MAX_DURATION_ACTUAL_BATCH + 1 }, (_, i) => record({ id: `id-${i}` })), NOW)],
    ['an empty id', () => buildDurationActuals('owner', [record({ id: ' ' })], NOW)],
    ['an id with a slash', () => buildDurationActuals('owner', [record({ id: 'a/b' })], NOW)],
    ['a duplicate id', () => buildDurationActuals('owner', [record(), record()], NOW)],
    ['an impossible date', () => buildDurationActuals('owner', [record({ occurrenceDate: '2026-02-30' })], NOW)],
    ['zero minutes', () => buildDurationActuals('owner', [record({ minutes: 0 })], NOW)],
    ['a full day or more', () => buildDurationActuals('owner', [record({ minutes: 1440 })], NOW)],
    ['fractional minutes', () => buildDurationActuals('owner', [record({ minutes: 30.5 })], NOW)],
    ['no subject', () => buildDurationActuals('owner', [record({ subject: ' ' })], NOW)],
  ])('rejects the whole batch for %s', (_name, build) => {
    expect(build).toThrow();
  });

  it('rejects the whole batch when only one record is bad', () => {
    expect(() => buildDurationActuals('owner', [record(), record({ id: 'second', minutes: 0 })], NOW)).toThrow();
  });
});

describe('local repository saveDurationActualsBatch', () => {
  function gateway(initial: Actual[] = []) {
    let actuals = initial;
    const writes: Actual[][] = [];
    const none = async () => [] as never[];
    const gw = { readActuals: async () => actuals, writeActuals: async (next: Actual[]) => { writes.push(next); actuals = next; },
      readPlans: none, readMonthEvents: none, readTodos: none, readDayNotes: none, readStudySubjects: none, readStudyMaterials: none,
      readScheduleTemplates: none, readTimetableTerms: none, readTimetablePeriods: none } as unknown as PlannerStorageGateway;
    return { gw, writes, current: () => actuals };
  }
  const week = [record(), record({ id: 'wp-actual-c1-2026-10-27-english', occurrenceDate: '2026-10-27', subject: '英語', minutes: 45 })];

  it('writes the batch once and saving it again leaves the same rows', async () => {
    const fixture = gateway();
    const repository = createPlannerRepository(fixture.gw);
    await repository.saveDurationActualsBatch('owner', week);
    await repository.saveDurationActualsBatch('owner', week);
    expect(fixture.current().map((a) => a.id).sort()).toEqual(week.map((r) => r.id).sort());
    expect(fixture.writes).toHaveLength(2);
  });

  it('never overwrites another owner’s row with the same id and writes nothing', async () => {
    const foreign: Actual = { ...buildDurationActuals('someone-else', [week[1]], NOW)[0] };
    const fixture = gateway([foreign]);
    await expect(createPlannerRepository(fixture.gw).saveDurationActualsBatch('owner', week)).rejects.toThrow('所有者');
    expect(fixture.writes).toEqual([]);
    expect(fixture.current()).toEqual([foreign]);
  });

  it('writes nothing when any record is invalid', async () => {
    const fixture = gateway();
    await expect(createPlannerRepository(fixture.gw).saveDurationActualsBatch('owner', [week[0], record({ id: 'bad', minutes: 0 })])).rejects.toThrow();
    expect(fixture.writes).toEqual([]);
  });
});
