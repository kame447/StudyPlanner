import { getFirebaseAuth, getFirestoreDb } from '../../../../lib/firebaseClient';
import { accountClientWritesPaused } from '../../../../services/accountDeletionClientState';
import { createFirestoreConversationStore } from './weeklyPlanningConversationFirestore';
import { createIndexedDbConversationStore } from './weeklyPlanningConversationIndexedDb';
import type { ConversationSyncDependencies } from './useWeeklyPlanningConversationSync';

export async function createConversationSyncBrowser(ownerId: string, alive: () => boolean): Promise<ConversationSyncDependencies | null> {
  const auth = getFirebaseAuth(), db = getFirestoreDb();
  if (!auth || !db) return null;
  const active = () => alive() && auth.currentUser?.uid === ownerId && !accountClientWritesPaused(ownerId);
  const local = createIndexedDbConversationStore();
  return { local, remote: createFirestoreConversationStore(db, ownerId, active),
    keys: () => Object.keys(window.localStorage),
    online: () => navigator.onLine,
    acquire: () => new Promise<() => void>((resolve, reject) => {
      if (!navigator.locks) { reject(new Error('conversation-lock-unavailable')); return; }
      // One writable replica per browser account; other devices still use shared revision CAS.
      void navigator.locks.request(`laplance-conversation-sync:${ownerId}`, { ifAvailable: true }, lock => {
        if (!lock || !active()) { reject(new Error(lock ? 'owner-changed' : 'conversation-open-in-another-tab')); return; }
        return new Promise<void>(release => resolve(release));
      }).catch(reject);
    }),
  };
}
