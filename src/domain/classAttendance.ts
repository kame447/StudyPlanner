import { isIsoCalendarDate } from '../lib/timetableCalendar';

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late-or-left'] as const;
export type AttendanceStatus = typeof ATTENDANCE_STATUSES[number];
export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  present: '出席', absent: '欠席', 'late-or-left': '遅刻・早退',
};

export interface ClassAttendance {
  schemaVersion: 1;
  userId: string;
  templateId: string;
  date: string;
  status: AttendanceStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ClassAttendanceDraft {
  userId: string;
  templateId: string;
  date: string;
  status: AttendanceStatus;
}

export function assertAttendanceScope(userId: string, templateId: string): void {
  if (![userId, templateId].every(value => value.length > 0 && !value.includes('/'))) {
    throw new Error('授業とログイン状態を確認してください。');
  }
}

export function assertAttendanceDraft(draft: ClassAttendanceDraft): void {
  assertAttendanceScope(draft.userId, draft.templateId);
  if (!isIsoCalendarDate(draft.date) || !ATTENDANCE_STATUSES.includes(draft.status)) {
    throw new Error('実施日と出欠を確認してください。');
  }
}

export function readClassAttendance(value: unknown, userId: string, templateId: string): ClassAttendance {
  const row = value as Partial<ClassAttendance> | null;
  if (!row || row.schemaVersion !== 1 || row.userId !== userId || row.templateId !== templateId
    || typeof row.date !== 'string' || typeof row.status !== 'string'
    || typeof row.createdAt !== 'string' || typeof row.updatedAt !== 'string') {
    throw new Error('出欠記録を読み込めませんでした。');
  }
  assertAttendanceDraft(row as ClassAttendance);
  return row as ClassAttendance;
}

export function attendanceCounts(records: readonly ClassAttendance[]): Record<AttendanceStatus, number> {
  const counts = { present: 0, absent: 0, 'late-or-left': 0 };
  for (const record of records) counts[record.status] += 1;
  return counts;
}
