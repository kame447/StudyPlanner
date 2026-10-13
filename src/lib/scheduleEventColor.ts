import type { CSSProperties } from 'react';
import type { ScheduleOccurrence } from '../domain/scheduleOccurrence';
import type { Plan, PlanType } from '../types/domain';
import { getSubjectTheme } from './subjectTheme';

// Keep the existing month-calendar palette. A saved source identity, rather
// than an occurrence date, title, or position in a list, owns its accent.
const MONTH_EVENT_COLORS = ['#6ec9a2', '#f4b85c', '#a787ef', '#72aefa', '#ef7b9f'];

export function getMonthEventColor(sourceId: string): string {
  let hash = 0;
  for (const character of sourceId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return MONTH_EVENT_COLORS[hash % MONTH_EVENT_COLORS.length];
}

function planTypeForOccurrence(occurrence: ScheduleOccurrence): PlanType {
  switch (occurrence.category) {
    case 'study': return 'study';
    case 'exam': return 'mock-exam';
    case 'class':
    case 'school': return 'school-event';
    case 'cram-school': return 'cram-school';
    case 'deadline': return 'deadline';
    default: return 'other';
  }
}

export function getScheduleOccurrenceColor(occurrence: ScheduleOccurrence): string {
  return occurrence.source.backingKind === 'month-event'
    ? getMonthEventColor(occurrence.source.backingId)
    : getSubjectTheme(occurrence.subject, planTypeForOccurrence(occurrence), occurrence.planSourceType).fill;
}

/** Read-model metadata only; never a new persisted Plan/MonthEvent field. */
export interface ScheduleColorPresentation { scheduleColor?: string }

export function getPlanScheduleColor(plan: Pick<Plan, 'subject' | 'type' | 'sourceType'> & ScheduleColorPresentation): string {
  return plan.scheduleColor ?? getSubjectTheme(plan.subject, plan.type, plan.sourceType).fill;
}

export function scheduleEventColorStyle(color: string): CSSProperties {
  return {
    '--schedule-event-color': color,
    '--schedule-event-bg': 'color-mix(in srgb, var(--schedule-event-color) 24%, var(--surface) 76%)',
    '--schedule-event-border': 'color-mix(in srgb, var(--schedule-event-color) 55%, var(--border) 45%)',
  } as CSSProperties;
}

export function scheduleEventWeekStyle(color: string): CSSProperties {
  return {
    ...scheduleEventColorStyle(color),
    '--weekly-draft-tone': 'var(--schedule-event-color)',
    '--weekly-draft-tone-bg': 'var(--schedule-event-bg)',
  } as CSSProperties;
}
