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

export interface UserPlanningContextForgottenEventV1 {
  ownerId: string;
  recordId: string;
}

const forgottenListeners = new Set<(event: UserPlanningContextForgottenEventV1) => void>();

/** A forget the user completed: other holders of a copy (a saved turn receipt) drop it. Ids only, never the words. */
export function subscribeUserPlanningContextForgottenV1(
  listener: (event: UserPlanningContextForgottenEventV1) => void,
): () => void {
  forgottenListeners.add(listener);
  return () => forgottenListeners.delete(listener);
}

export function publishUserPlanningContextForgottenV1(event: UserPlanningContextForgottenEventV1): void {
  for (const listener of forgottenListeners) {
    try {
      listener({ ...event });
    } catch {
      // Each holder clears its own copy; one failing must not stop the others or the forget itself.
    }
  }
}

export function resetUserPlanningContextSyncEventsForTestV1(): void {
  listeners.clear();
  forgottenListeners.clear();
}
