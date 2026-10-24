import type { ClassAttendanceRepository } from '../repositories/classAttendanceRepository';

// A detail may be closed while its admitted write is still settling. Keep only
// those pending operations, never history, so a reopened detail reads afterward.
const pendingSaves = new WeakMap<ClassAttendanceRepository, Map<string, Set<Promise<void>>>>();
const saveScope = (userId: string, templateId: string) => JSON.stringify([userId, templateId]);

// The returned settlement callback is single-use, owned by the caller's finally block.
export function beginClassAttendanceSave(repository: ClassAttendanceRepository, userId: string, templateId: string) {
  let scopes = pendingSaves.get(repository);
  if (!scopes) pendingSaves.set(repository, scopes = new Map());
  const key = saveScope(userId, templateId);
  let saves = scopes.get(key);
  if (!saves) scopes.set(key, saves = new Set());
  let settle!: () => void;
  const pending = new Promise<void>(resolve => { settle = resolve; });
  saves.add(pending);
  return () => {
    saves.delete(pending);
    if (saves.size === 0) scopes.delete(key);
    if (scopes.size === 0) pendingSaves.delete(repository);
    settle();
  };
}


// A snapshot prevents callers from mutating coordinator ownership. The caller
// must recheck after awaiting it: another save can be admitted during the wait.
export function getPendingClassAttendanceSaves(
  repository: ClassAttendanceRepository,
  userId: string,
  templateId: string,
): readonly Promise<void>[] {
  return [...(pendingSaves.get(repository)?.get(saveScope(userId, templateId)) ?? [])];
}
