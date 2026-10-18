import type { ScheduleOccurrence } from '../domain/scheduleOccurrence';
import { createPlanDraftFromPlan } from '../domain/planner';
import type { Actual, ActualDraft, MonthEvent, Plan, PlanDraft } from '../types/domain';
import { createActualDraftForPlan } from './actualDrafts';
import { buildPlanOccurrenceKey, getActualOccurrenceKey, resolvePlanOccurrence } from './planRecurrence';
import { SCHEDULE_RADIAL_ACTION_LABELS, SCHEDULE_RADIAL_ACTION_ORDER, type ScheduleRadialActionDescriptor } from './scheduleRadialActions';
import { scheduleOccurrenceCoversDate, scheduleOccurrenceTimesForDate } from './weekViewLayout';
import { getEntryDurationMinutes, resolveEntryEndTime } from './entryTimeRange';
import type { WeekPlanMoveTarget } from './weekPlanDrag';

export function createMonthEventActualPlan(monthEvent: MonthEvent, userId: string, occurrenceDate: string): Plan {
  const memoParts = [monthEvent.memo.trim(), monthEvent.locationTags.length > 0
    ? `場所タグ: ${monthEvent.locationTags.join(', ')}` : '', monthEvent.url.trim() ? `URL: ${monthEvent.url.trim()}` : ''].filter(Boolean);
  return { id: monthEvent.id, seriesId: monthEvent.id, userId, title: monthEvent.title,
    subject: '主要予定', date: occurrenceDate, startTime: monthEvent.startTime, endTime: monthEvent.endTime,
    repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], type: 'other', memo: memoParts.join('\n'),
    createdAt: monthEvent.createdAt, updatedAt: monthEvent.updatedAt, sourceType: 'manual', sourceId: monthEvent.id, occurrenceDate };
}

export function resolveScheduleActionPlan(occurrence: ScheduleOccurrence, plans: Plan[], monthEvents: MonthEvent[], viewedDate: string): Plan | null {
  if (occurrence.source.backingKind === 'plan') {
    const source = plans.find(plan => plan.id === occurrence.source.backingId && plan.userId === occurrence.ownerId);
    return source ? resolvePlanOccurrence(source, occurrence.start.date) : null;
  }
  if (occurrence.source.backingKind === 'month-event') {
    const source = monthEvents.find(event => event.id === occurrence.source.backingId && event.userId === occurrence.ownerId);
    const date = scheduleOccurrenceCoversDate(occurrence, viewedDate) ? viewedDate : occurrence.start.date;
    return source ? createMonthEventActualPlan({ ...source, ...scheduleOccurrenceTimesForDate(occurrence, date) }, occurrence.ownerId, date) : null;
  }
  return null;
}

export function createDuplicatePlanDraft(plan: Plan): PlanDraft {
  const draft = createPlanDraftFromPlan(plan);
  // A reviewed copy is an independent manual plan, never another class binding or observation.
  delete draft.classTemplateId;
  delete draft.weeklyPlanningObservationSource;
  return { ...draft, repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [] };
}

export function createCompletionDraft(plan: Plan): ActualDraft {
  return { ...createActualDraftForPlan(plan), isAlignedToPlan: true };
}

export interface ScheduleActionCapabilities {
  edit: boolean; move: boolean; duplicate: boolean; actual: boolean; delete: boolean;
  actualBlockReason?: string | null;
}
export function scheduleItemActions(occurrence: ScheduleOccurrence, capabilities: ScheduleActionCapabilities): ScheduleRadialActionDescriptor[] {
  const isPlan = occurrence.source.backingKind === 'plan';
  const isTimetable = occurrence.source.backingKind === 'timetable-template';
  const kind = isTimetable ? '時間割の予定' : '主要予定';
  const recordReason = capabilities.actualBlockReason || (!capabilities.actual ? 'この予定の実績を入力できません' : null);
  const reasons = {
    complete: isTimetable ? '時間割の予定は予定に反映してから実績を入力してください' : recordReason,
    edit: !capabilities.edit ? 'この予定の詳細を開けません' : null,
    duplicate: !isPlan ? `${kind}は複製できません` : !capabilities.duplicate ? 'この予定を複製できません' : null,
    delete: !capabilities.delete ? `${kind}はこの画面から削除できません` : null,
    actual: recordReason,
    move: !isPlan ? `${kind}はこの画面から移動できません` : !capabilities.move ? 'この予定を移動できません' : null,
  };
  return SCHEDULE_RADIAL_ACTION_ORDER.map(id => ({ id, label: SCHEDULE_RADIAL_ACTION_LABELS[id], disabledReason: reasons[id] }));
}

/** Holds successful acknowledgements until the actual projection arrives as well as in-flight writes. */
export class ScheduleCompletionGuard {
  private pending = new Set<string>();
  private acknowledged = new Set<string>();
  private observed = new Set<string>();
  observe(actuals: Actual[]) {
    this.observed = new Set(actuals.map(actual => `${actual.userId}:${getActualOccurrenceKey(actual)}`));
    for (const key of this.observed) this.acknowledged.delete(key);
  }
  begin(plan: Plan, actuals: Actual[]): 'started' | 'existing' | 'pending' {
    const key = buildPlanOccurrenceKey(plan.id, plan.occurrenceDate ?? plan.date);
    const scopedKey = `${plan.userId}:${key}`;
    if (this.pending.has(scopedKey)) return 'pending';
    if (actuals.some(actual => actual.userId === plan.userId && getActualOccurrenceKey(actual) === key)) {
      this.acknowledged.delete(scopedKey);
      return 'existing';
    }
    if (this.acknowledged.has(scopedKey)) return 'existing';
    this.pending.add(scopedKey);
    return 'started';
  }
  finish(plan: Plan, saved: boolean) {
    const key = `${plan.userId}:${buildPlanOccurrenceKey(plan.id, plan.occurrenceDate ?? plan.date)}`;
    this.pending.delete(key);
    if (saved && !this.observed.has(key)) this.acknowledged.add(key);
  }
}

export function scheduleMoveTarget(plan: Plan, date: string, startTime: string): WeekPlanMoveTarget | null {
  const endTime = resolveEntryEndTime(startTime, getEntryDurationMinutes(plan.startTime, plan.endTime));
  return date && endTime ? { date, startTime, endTime } : null;
}

export function isScheduleActionMenuTarget(target: EventTarget | null): boolean {
  return typeof Element !== 'undefined' && target instanceof Element
    && Boolean(target.closest('[data-schedule-item-delete-action="true"]'));
}
