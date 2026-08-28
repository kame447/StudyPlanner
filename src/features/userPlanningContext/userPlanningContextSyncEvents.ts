import type { UserPlanningContextRecordV1 } from './userPlanningContextTypes';

export interface UserPlanningContextCommittedEventV1 {
  ownerId: string;
  records: UserPlanningContextRecordV1[];
}

type Listener = (event: UserPlanningContextCommittedEventV1) => void;

const listeners = new Set<Listener>();

export function subscribeUserPlanningContextCommittedV1(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishUserPlanningContextCommittedV1(
  event: UserPlanningContextCommittedEventV1,
): void {
  if (event.records.length === 0) return;
  for (const listener of listeners) {
    try {
      listener({
        ownerId: event.ownerId,
        records: event.records.map((record) => ({ ...record })),
      });
    } catch {
      // Cloud synchronization is fail-soft and must not invalidate a committed planning turn.
    }
  }
}

export function resetUserPlanningContextSyncEventsForTestV1(): void {
  listeners.clear();
}
