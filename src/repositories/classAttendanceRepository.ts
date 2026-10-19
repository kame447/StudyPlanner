import {
  assertAttendanceDraft, assertAttendanceScope, readClassAttendance,
  type ClassAttendance, type ClassAttendanceDraft,
} from '../domain/classAttendance';
import type { PlannerRepository } from './repositoryContracts';

export interface ClassAttendanceRepository {
  list(userId: string, templateId: string): Promise<ClassAttendance[]>;
  save(draft: ClassAttendanceDraft): Promise<ClassAttendance>;
}

// Each occurrence has its own key: correcting one date never rewrites another
// lesson, owner or a whole history collection. Study Actual storage is untouched.
export function createLocalClassAttendanceRepository(
  storage: Storage,
  planner: Pick<PlannerRepository, 'getScheduleTemplates'>,
): ClassAttendanceRepository {
  function prefix(userId: string, templateId: string) {
    assertAttendanceScope(userId, templateId);
    return `studyplanner.classAttendance.v1:${encodeURIComponent(userId)}:${encodeURIComponent(templateId)}:`;
  }
  return {
    async list(userId, templateId) {
      const keyPrefix = prefix(userId, templateId);
      const rows: ClassAttendance[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key?.startsWith(keyPrefix)) continue;
        const raw = storage.getItem(key);
        if (raw !== null) {
          const record = readClassAttendance(JSON.parse(raw), userId, templateId);
          if (key !== `${keyPrefix}${record.date}`) throw new Error('出欠記録の日付が一致しません。');
          rows.push(record);
        }
      }
      return rows.sort((a, b) => b.date.localeCompare(a.date));
    },
    async save(draft) {
      assertAttendanceDraft(draft);
      const templates = await planner.getScheduleTemplates(draft.userId);
      if (!templates.some(template => template.id === draft.templateId && template.userId === draft.userId)) {
        throw new Error('この授業は削除されたか、利用できなくなりました。');
      }
      const key = `${prefix(draft.userId, draft.templateId)}${draft.date}`;
      const raw = storage.getItem(key);
      const previous = raw === null ? null : readClassAttendance(JSON.parse(raw), draft.userId, draft.templateId);
      const now = new Date().toISOString();
      const row: ClassAttendance = { ...draft, schemaVersion: 1, createdAt: previous?.createdAt ?? now, updatedAt: now };
      storage.setItem(key, JSON.stringify(row));
      return row;
    },
  };
}

export function createUnavailableClassAttendanceRepository(): ClassAttendanceRepository {
  const unavailable = async (): Promise<never> => { throw new Error('出欠の保存設定を確認できませんでした。'); };
  return { list: unavailable, save: unavailable };
}
