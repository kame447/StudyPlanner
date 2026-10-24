import { expect, it } from 'vitest';
import { actual as makeActual, plan as makePlan } from '../repositories/localPersistenceConcurrency.testUtils';
import { buildHomeDashboardModel } from './homeDashboard';
import { buildMonthPanelProjection } from './monthViewProjection';
import { buildMaterialActivitySummary } from './bookshelfMaterialDetails';
import { getActualMinutes, getPlannedMinutes } from './studyAnalytics';
import type { StudyMaterial } from '../types/domain';

it.each([
  ['2026-10-15', '2026-10-16'], ['2026-10-31', '2026-11-01'], ['2026-12-31', '2027-01-01'],
])('counts the entire %s overnight entry once on its start day, including after %s', (date, next) => {
  const plan = makePlan({ date, startTime: '23:30', endTime: '00:30', materialId: 'material' });
  const actual = makeActual({ occurrenceDate: date, actualStartTime: '23:30', actualEndTime: '00:30', materialId: 'material' });
  const home = buildHomeDashboardModel({ plans: [plan], actuals: [actual], todos: [], now: new Date(`${date}T23:45:00`) });
  expect([home.weekPlannedMinutes, home.weekActualMinutes]).toEqual([60, 60]);
  expect([home.weekExpectedMinutesByNow, home.weekActualMinutesByNow]).toEqual([15, 15]);
  expect(home.weekDays.find(day => day.date === date)).toMatchObject({ plannedMinutes: 60, actualMinutes: 60 });
  expect(home.weekDays.filter(day => day.date !== date).every(day => day.plannedMinutes === 0 && day.actualMinutes === 0)).toBe(true);
  expect(home.nextPlan?.id).toBe(plan.id);
  expect(home.missingActualPlans).toEqual([]);
  const noRecord = buildHomeDashboardModel({ plans: [plan], actuals: [], todos: [], now: new Date(`${date}T23:45:00`) });
  expect(noRecord.missingActualPlans).toEqual([]);
  const nextDay = buildHomeDashboardModel({ plans: [plan], actuals: [actual], todos: [], now: new Date(`${next}T00:10:00`) });
  expect([nextDay.weekExpectedMinutesByNow, nextDay.weekActualMinutesByNow]).toEqual([40, 40]);
  for (const monthDate of [date, next]) {
    const month = buildMonthPanelProjection({ monthDate, userId: 'owner', plans: [plan], actuals: [actual], monthEvents: [] });
    expect(month.cells.find(day => day.date === date)).toMatchObject({ targetMinutes: 60, actualMinutes: 60 });
    expect(month.cells.find(day => day.date === next)).toMatchObject({ targetMinutes: 0, actualMinutes: 0 });
    expect(month.cells.reduce((sum, day) => sum + day.actualMinutes, 0)).toBe(60);
  }
  expect(getPlannedMinutes(plan)).toBe(60);
  expect(getActualMinutes(actual)).toBe(60);
  const material: StudyMaterial = { id: 'material', userId: 'owner', name: 'Book', subjectId: 'math', subjectName: 'Math', status: 'active', createdAt: '', updatedAt: '' };
  expect(buildMaterialActivitySummary(material, [plan], [actual], date)).toMatchObject({ plannedMinutes: 60, actualMinutes: 60 });
});
