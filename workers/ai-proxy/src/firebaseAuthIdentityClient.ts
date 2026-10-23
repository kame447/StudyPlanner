import {
  FirestoreServiceAccountTokenProvider,
  type FirestoreServiceAccountEnv,
  type FirestoreTokenProvider,
} from './firestoreServiceAccountClient';
import type { WorkerSubrequestObserver } from './workerSubrequestBudget';

const IDENTITY_TOOLKIT_SCOPE = 'https://www.googleapis.com/auth/identitytoolkit';
const MAX_LOOKUP_USERS = 5;
const LOOKUP_FAILED = 'observability_auth_identity_lookup_failed';
const workerSafeFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

export interface FirebaseAuthIdentity {
  firebaseUid: string;
  // Empty unless Firebase Auth confirms ownership of the current email.
  email: string;
}

export interface FirebaseAuthIdentityLookup {
  lookupByEmail(email: string): Promise<FirebaseAuthIdentity[]>;
  lookupByUids(firebaseUids: readonly string[]): Promise<FirebaseAuthIdentity[]>;
}

export class FirebaseAuthIdentityClient implements FirebaseAuthIdentityLookup {
  private readonly tokenProvider: FirestoreTokenProvider;

  constructor(
    private readonly env: FirestoreServiceAccountEnv,
    tokenProvider?: FirestoreTokenProvider,
    private readonly fetcher: typeof fetch = workerSafeFetch,
    subrequestObserver?: WorkerSubrequestObserver,
  ) {
    this.tokenProvider = tokenProvider ?? new FirestoreServiceAccountTokenProvider(
      env, fetcher, crypto, subrequestObserver, IDENTITY_TOOLKIT_SCOPE,
    );
  }

  async lookupByEmail(email: string): Promise<FirebaseAuthIdentity[]> {
    const normalized = email.trim().toLowerCase();
    const users = await this.lookup({ email: [normalized] });
    return users.filter(user => user.email !== '' && user.email.toLowerCase() === normalized);
  }

  async lookupByUids(firebaseUids: readonly string[]): Promise<FirebaseAuthIdentity[]> {
    if (firebaseUids.length === 0) return [];
    const users = await this.lookup({ localId: [...firebaseUids] });
    if (users.some(user => !firebaseUids.includes(user.firebaseUid))) {
      throw new Error(LOOKUP_FAILED);
    }
    return users;
  }

  private async lookup(criteria: { email: string[] } | { localId: string[] }): Promise<FirebaseAuthIdentity[]> {
    try {
      const projectId = this.env.FIREBASE_PROJECT_ID?.trim();
      const identifiers = 'email' in criteria ? criteria.email : criteria.localId;
      if (!projectId || identifiers.length > MAX_LOOKUP_USERS || identifiers.some(id => !id)) {
        throw new Error(LOOKUP_FAILED);
      }
      const token = await this.tokenProvider.getToken();
      this.tokenProvider.subrequestObserver?.beforeSubrequest('identity_toolkit');
      const response = await this.fetcher(
        `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:lookup`,
        {
          method: 'POST',
          redirect: 'manual',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(criteria),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(LOOKUP_FAILED);
      }
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error(LOOKUP_FAILED);
      const users = (payload as { users?: unknown }).users;
      if (users === undefined) return [];
      if (!Array.isArray(users) || users.length > MAX_LOOKUP_USERS) throw new Error(LOOKUP_FAILED);
      const seen = new Set<string>();
      return users.map((user: unknown) => {
        if (!user || typeof user !== 'object' || Array.isArray(user)) throw new Error(LOOKUP_FAILED);
        const { localId, email, emailVerified } = user as Record<string, unknown>;
        if (typeof localId !== 'string' || !localId.trim() || seen.has(localId)
          || (email !== undefined && typeof email !== 'string')
          || (emailVerified !== undefined && typeof emailVerified !== 'boolean')
          || (emailVerified === true && (typeof email !== 'string' || !email.trim()))) {
          throw new Error(LOOKUP_FAILED);
        }
        seen.add(localId);
        return { firebaseUid: localId, email: emailVerified === true ? (email as string).trim() : '' };
      });
    } catch {
      // Provider errors can contain the searched address or credential details.
      throw new Error(LOOKUP_FAILED);
    }
  }
}
