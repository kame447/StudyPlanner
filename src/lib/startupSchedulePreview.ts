import { resolveActiveTimetableTerm } from '../domain/timetableTerm';
import type { MonthEvent, Plan, ScheduleTemplate, TimetableTerm } from '../types/domain';
import { addDays, sortByDateTime, toIsoDate } from './date';
import { augmentHomePlansWithScheduleOccurrences } from './homeScheduleAugmentation';
import { expandPlansForDate } from './planRecurrence';

export interface CommittedScheduleRead {
  ownerId: string;
  plans: Plan[];
  monthEvents: MonthEvent[];
  scheduleTemplates: ScheduleTemplate[];
  timetableTerms: TimetableTerm[];
}
export type ScheduleReadObserver = (snapshot: CommittedScheduleRead) => void;
export interface StartupScheduleRow { date: string; startTime: string; endTime: string; title: string; subject: string }
export interface StartupSchedulePreview {
  version: 1; ownerId: string; savedAt: number; startDate: string; endDate: string; rows: StartupScheduleRow[];
}
const PREFIX = 'studyplanner.startup-schedule.v1:';
const DISABLED_KEY = 'studyplanner.startup-schedule.disabled';
let disabled = false;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_ROWS = 160;
const MAX_BYTES = 96 * 1024;
const key = (ownerId: string) => `${PREFIX}${encodeURIComponent(ownerId)}`;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const time = (value: unknown): value is string => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(value);

export function createStartupSchedulePreview(source: CommittedScheduleRead, now = new Date()): StartupSchedulePreview {
  const startDate = toIsoDate(now);
  const endDate = addDays(startDate, 7);
  const own = <T extends { userId: string }>(rows: T[]) => rows.filter(row => row.userId === source.ownerId);
  const terms = own(source.timetableTerms);
  const active = resolveActiveTimetableTerm(terms);
  const plans = augmentHomePlansWithScheduleOccurrences({ ownerId: source.ownerId,
    plans: own(source.plans), monthEvents: own(source.monthEvents), scheduleTemplates: own(source.scheduleTemplates),
    timetableTerms: terms, timetableTerm: active.term, timetableTermId: active.termId, startDate });
  const rows = sortByDateTime(Array.from({ length: 8 }, (_, index) => addDays(startDate, index))
    .flatMap(day => expandPlansForDate(plans, day))).slice(0, MAX_ROWS)
    .map(plan => ({ date: plan.date, startTime: plan.startTime, endTime: plan.endTime,
      title: plan.title.slice(0, 240), subject: plan.subject.slice(0, 120) }));
  return { version: 1, ownerId: source.ownerId, savedAt: now.getTime(), startDate, endDate, rows };
}

export function readStartupSchedulePreview(ownerId: string, now = new Date()): StartupSchedulePreview | null {
  try {
    if (disabled || window.localStorage.getItem(DISABLED_KEY) === '1') return null;
    const serialized = window.localStorage.getItem(key(ownerId));
    if (!serialized || serialized.length > MAX_BYTES || new TextEncoder().encode(serialized).length > MAX_BYTES) return null;
    const value = JSON.parse(serialized);
    const today = toIsoDate(now);
    if (!value || value.version !== 1 || value.ownerId !== ownerId || !Number.isFinite(value.savedAt)
      || now.getTime() < value.savedAt || now.getTime() - value.savedAt > MAX_AGE_MS
      || !date(value.startDate) || !date(value.endDate) || value.endDate !== addDays(value.startDate, 7)
      || today < value.startDate || today > value.endDate
      || !Array.isArray(value.rows) || value.rows.length > MAX_ROWS
      || value.rows.some((row: StartupScheduleRow) => !row || !date(row.date) || row.date < value.startDate || row.date > value.endDate
        || !time(row.startTime) || !time(row.endTime) || !text(row.title, 240) || !text(row.subject, 120))) return null;
    return { version: 1, ownerId, savedAt: value.savedAt, startDate: value.startDate, endDate: value.endDate,
      rows: value.rows.map((row: StartupScheduleRow) => ({ date: row.date, startTime: row.startTime, endTime: row.endTime, title: row.title, subject: row.subject })) };
  } catch { return null; }
}
export function saveStartupSchedulePreview(source: CommittedScheduleRead, now = new Date()): void {
  try {
    const serialized = JSON.stringify(createStartupSchedulePreview(source, now));
    if (new TextEncoder().encode(serialized).length <= MAX_BYTES) {
      if (disabled || window.localStorage.getItem(DISABLED_KEY) === '1') removeStoredCopies();
      window.localStorage.setItem(key(source.ownerId), serialized);
      window.localStorage.removeItem(DISABLED_KEY);
      disabled = false;
    }
  } catch { /* Optional presentation cache must never fail the authoritative read. */ }
}
function removeStoredCopies() {
  const storage = window.localStorage;
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const entry of keys) if (entry?.startsWith(PREFIX)) storage.removeItem(entry);
}
export function clearStartupSchedulePreviews(): void {
  disabled = true;
  // Persist revocation before removal. Readable-but-nonremovable storage must
  // not resurrect a snapshot; only a later successful fresh write re-enables it.
  try { window.localStorage.setItem(DISABLED_KEY, '1'); } catch { /* Still disabled in this document. */ }
  try {
    removeStoredCopies();
  } catch { /* Physical removal may fail; the revocation marker and local guard remain. */ }
}
