import { describe, expect, it } from 'vitest';
import { createScheduleOccurrenceProjection } from '../domain/scheduleOccurrence';
import type { Actual, Plan, ScheduleTemplate } from '../types/domain';
import { createCompletionDraft, createDuplicatePlanDraft, ScheduleCompletionGuard, scheduleItemActions, scheduleMoveTarget, resolveScheduleActionPlan, resolveCurrentScheduleActionOccurrence } from './scheduleItemActions';
const plan: Plan = { id: 'p', seriesId: 'p', userId: 'u', title: '数学', subject: '数学', date: '2026-10-05',
  startTime: '23:00', endTime: '01:00', repeat: 'weekly', repeatUntil: '2026-11-01', recurrenceRules: [], excludedDates: [],
  type: 'study', memo: '内容', materialId: 'm', materialName: '問題集', createdAt: '', updatedAt: '' };
const actual = (occurrenceDate = plan.date): Actual => ({ ...createCompletionDraft(plan), id: 'a', occurrenceDate, updatedAt: '' });
const capabilities = { edit: true, move: true, duplicate: true, actual: true, delete: true };
describe('schedule action semantics', () => {
  it('copies planned content and occurrence times into an aligned actual without mutating the plan', () => {
    const before = structuredClone(plan);
    expect(createCompletionDraft({ ...plan, occurrenceDate: '2026-10-12' })).toEqual({ userId: 'u', planId: 'p', occurrenceDate: '2026-10-12',
      actualStartTime: '23:00', actualEndTime: '01:00', title: '数学', subject: '数学', isAlignedToPlan: true, note: '', materialId: 'm', materialName: '問題集' });
    expect(plan).toEqual(before);
  });
  it('creates a reviewed single-plan draft with all visible content and no class binding', () => {
    const draft = createDuplicatePlanDraft({ ...plan, classTemplateId: 'class', occurrenceDate: '2026-10-12' });
    expect(draft).toMatchObject({ title: plan.title, date: '2026-10-12', startTime: plan.startTime, endTime: plan.endTime,
      subject: plan.subject, materialId: 'm', materialName: '問題集', memo: plan.memo, type: plan.type,
      repeat: 'none', repeatUntil: null, recurrenceRules: [], excludedDates: [] });
    expect(draft).not.toHaveProperty('id'); expect(draft).not.toHaveProperty('classTemplateId');
  });
  it('rejects existing actuals only for the same owner and occurrence', () => {
    const guard = new ScheduleCompletionGuard();
    expect(guard.begin(plan, [actual()])).toBe('existing');
    expect(guard.begin({ ...plan, occurrenceDate: '2026-10-12' }, [actual()])).toBe('started');
    expect(new ScheduleCompletionGuard().begin(plan, [{ ...actual(), userId: 'other' }])).toBe('started');
  });
  it('rejects reentrant and acknowledged completions before actual props arrive; failure remains retryable', () => {
    const guard = new ScheduleCompletionGuard();
    expect(guard.begin(plan, [])).toBe('started'); expect(guard.begin(plan, [])).toBe('pending');
    guard.finish(plan, false); expect(guard.begin(plan, [])).toBe('started');
    guard.finish(plan, true); expect(guard.begin(plan, [])).toBe('existing');
    expect(guard.begin(plan, [actual()])).toBe('existing');
    // Once the saved actual was observed, explicitly deleting it permits a fresh completion.
    expect(guard.begin(plan, [])).toBe('started');
  });
  it('preserves overnight duration and represents midnight as 24:00', () => {
    expect(scheduleMoveTarget(plan, '2026-10-06', '23:30')).toEqual({ date: '2026-10-06', startTime: '23:30', endTime: '01:30' });
    expect(scheduleMoveTarget(plan, '2026-10-06', '22:00')?.endTime).toBe('24:00');
    expect(scheduleMoveTarget(plan, plan.date, 'invalid')).toBeNull();
  });
  it('keeps all six actions in the contract order for each backing kind with concrete disabled reasons', () => {
    const month = { id: 'e', userId: 'u', date: plan.date, title: '行事', startTime: '12:00', endTime: '13:00', repeat: 'none' as const, repeatUntil: null,
      excludedDates: [], memo: '', url: '', checklist: [], locationTags: [], createdAt: '', updatedAt: '' };
    const template: ScheduleTemplate = { id: 't', userId: 'u', title: '授業', subject: '数学', type: 'school-event', termId: 'term', weekday: 'mon',
      startTime: '09:00', endTime: '10:00', active: true, periodNumber: 1, classroom: '', memo: '', createdAt: '', updatedAt: '' };
    const occurrences = createScheduleOccurrenceProjection({ ownerId: 'u', startDate: plan.date, endDate: plan.date,
      plans: [plan], monthEvents: [month], scheduleTemplates: [template], timetableTermId: 'term' }).occurrences;
    expect(occurrences).toHaveLength(3);
    for (const occurrence of occurrences) {
      const actions = scheduleItemActions(occurrence, capabilities);
      expect(actions.map(action => action.id)).toEqual(['complete', 'edit', 'duplicate', 'delete', 'actual', 'move']);
      expect(actions.map(action => action.label)).toEqual(['完了', '編集', '複製', '削除', '実績', '移動']);
      const disabled = actions.filter(action => action.disabledReason).map(action => action.id);
      expect(disabled).toEqual(occurrence.source.backingKind === 'plan' ? [] : occurrence.source.backingKind === 'month-event' ? ['edit', 'duplicate', 'move'] : ['complete', 'duplicate', 'move']);
      expect(scheduleItemActions(occurrence, { ...capabilities, actualBlockReason: '再読み込みしてください' }).find(action => action.id === 'actual')?.disabledReason).toBe('再読み込みしてください');
    }
  });
});

it('uses a month-event date in the displayed week rather than the selected week anchor', () => {
  const event = { id: 'e', userId: 'u', date: '2026-10-07', title: '行事', startTime: '12:00', endTime: '13:00', repeat: 'none' as const,
    repeatUntil: null, excludedDates: [], memo: '', url: '', checklist: [], locationTags: [], createdAt: '', updatedAt: '' };
  const occurrence = createScheduleOccurrenceProjection({ ownerId: 'u', startDate: plan.date, endDate: '2026-10-11', plans: [], monthEvents: [event] }).occurrences[0];
  expect(resolveScheduleActionPlan(occurrence, [], [event], plan.date, [occurrence])).toMatchObject({ date: event.date, startTime: event.startTime, endTime: event.endTime });
});
it('permits completion after an acknowledged actual was projected and explicitly deleted', () => {
  const guard = new ScheduleCompletionGuard();
  expect(guard.begin(plan, [])).toBe('started');
  guard.observe([actual()]); guard.finish(plan, true); guard.observe([]);
  expect(guard.begin(plan, [])).toBe('started');
});

it.each(['moved', 'excluded', 'time-changed'] as const)('rejects a stale %s plan target instead of projecting an old actual date', change => {
  const original = { ...plan, repeat: 'none' as const };
  const project = (plans: Plan[]) => createScheduleOccurrenceProjection({ ownerId: 'u', startDate: plan.date, endDate: '2026-10-11', plans }).occurrences;
  const target = project([original])[0];
  const current = { ...original, ...(change === 'moved' ? { date: '2026-10-06' }
    : change === 'excluded' ? { excludedDates: [plan.date] } : { startTime: '22:00' }) };
  expect(resolveCurrentScheduleActionOccurrence(target, project([current]))).toBeNull();
  expect(resolveScheduleActionPlan(target, [current], [], plan.date, project([current]))).toBeNull();
});
it('rejects stale month-event times and returns only a current matching occurrence', () => {
  const event = { id: 'e', userId: 'u', date: plan.date, title: '行事', startTime: '12:00', endTime: '13:00', repeat: 'none' as const,
    repeatUntil: null, excludedDates: [], memo: '', url: '', checklist: [], locationTags: [], createdAt: '', updatedAt: '' };
  const project = (monthEvents: typeof event[]) => createScheduleOccurrenceProjection({ ownerId: 'u', startDate: plan.date, endDate: plan.date, plans: [], monthEvents }).occurrences;
  const old = project([event])[0];
  const changed = { ...event, startTime: '15:00', endTime: '16:00' }; const current = project([changed]);
  expect(resolveScheduleActionPlan(old, [], [changed], plan.date, current)).toBeNull();
  expect(resolveScheduleActionPlan(current[0], [], [changed], plan.date, current)).toMatchObject({ startTime: '15:00', endTime: '16:00' });
  expect(resolveCurrentScheduleActionOccurrence(structuredClone(current[0]), current)).toBe(current[0]);
});
