import type { CSSProperties } from 'react';
import type { ScheduleOccurrence } from '../domain/scheduleOccurrence';
import type { MonthEventColor, Plan, PlanType } from '../types/domain';
import { getSubjectTheme } from './subjectTheme';

// Keep the existing month-calendar palette. A saved source identity, rather
// than an occurrence date, title, or position in a list, owns its accent.
export const MONTH_EVENT_COLOR_OPTIONS = [
  { key: 'green', label: '緑', color: '#6ec9a2' },
  { key: 'orange', label: 'オレンジ', color: '#f4b85c' },
  { key: 'purple', label: '紫', color: '#a787ef' },
  { key: 'blue', label: '青', color: '#72aefa' },
  { key: 'pink', label: 'ピンク', color: '#ef7b9f' },
] as const satisfies readonly { key: MonthEventColor; label: string; color: string }[];

export function getMonthEventColor(sourceId: string, color?: MonthEventColor): string {
  const selected = MONTH_EVENT_COLOR_OPTIONS.find(option => option.key === color);
  if (selected) return selected.color;
  let hash = 0;
  for (const character of sourceId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return MONTH_EVENT_COLOR_OPTIONS[hash % MONTH_EVENT_COLOR_OPTIONS.length].color;
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
    ? getMonthEventColor(occurrence.source.backingId, occurrence.color)
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

export function scheduleEventWeekStyle(color: string, surface: 'theme' | 'pastel' = 'theme'): CSSProperties {
  return {
    ...scheduleEventColorStyle(color),
    '--weekly-draft-tone': 'var(--schedule-event-color)',
    // Existing study/class week blocks deliberately stay light in dark mode.
    // Keep their semantic accent without replacing that readability contract.
    '--weekly-draft-tone-bg': surface === 'pastel'
      ? 'color-mix(in srgb, var(--schedule-event-color) 13%, #fff 87%)'
      : 'var(--schedule-event-bg)',
    ...(surface === 'pastel' ? { '--text': '#263238', '--text-muted': '#52606d' } : {}),
  } as CSSProperties;
}
