import { doc, getDoc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { getFirestoreDb } from '../lib/firebaseClient';

export interface AdminProfileDocument {
  enabled?: boolean;
  email?: string;
  createdAt?: string;
  memo?: string;
}

const noop = () => {};

function isEnabledAdmin(data: AdminProfileDocument | undefined): boolean {
  return data?.enabled === true;
}

export async function getAdminStatus(uid: string | null | undefined): Promise<boolean> {
  if (!uid) {
    return false;
  }

  const firestoreDb = getFirestoreDb();

  if (!firestoreDb) {
    return false;
  }

  try {
    const snapshot = await getDoc(doc(firestoreDb, 'admins', uid));
    return snapshot.exists() && isEnabledAdmin(snapshot.data() as AdminProfileDocument);
  } catch {
    return false;
  }
}

export function subscribeAdminStatus(
  uid: string | null | undefined,
  callback: (isAdmin: boolean) => void,
): Unsubscribe {
  if (!uid) {
    callback(false);
    return noop;
  }

  const firestoreDb = getFirestoreDb();

  if (!firestoreDb) {
    callback(false);
    return noop;
  }

  return onSnapshot(
    doc(firestoreDb, 'admins', uid),
    (snapshot) => {
      callback(
        snapshot.exists() &&
          isEnabledAdmin(snapshot.data() as AdminProfileDocument),
      );
    },
    () => {
      callback(false);
    },
  );
}
