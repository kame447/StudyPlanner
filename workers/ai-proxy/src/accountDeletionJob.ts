import { FirestoreWriteConflictError, type FirestoreServiceAccountClient } from './firestoreServiceAccountClient';
import { WorkerSubrequestBudget, type WorkerSubrequestPhase } from './workerSubrequestBudget';

export const ACCOUNT_DELETION_COLLECTION = 'account_deletions';
const RETENTION_MS = 180 * 86_400_000;
// Longer than one bounded request; a crashed holder only delays a retry.
const LEASE_MS = 120_000;
const PAGE_SIZE = 100;

export class AccountDeletionYield extends Error {}
export class AccountDeletionBusy extends Error {}

// Leave room to persist a checkpoint/error after any operation yields.
export class AccountDeletionBudget extends WorkerSubrequestBudget {
  private saving = false;
  constructor() { super('fetch', '/account/delete'); }
  override beforeSubrequest(phase: WorkerSubrequestPhase): void {
    if (!this.saving && this.snapshot().attemptedSubrequests >= 38) throw new AccountDeletionYield();
    super.beforeSubrequest(phase);
  }
  async save<T>(operation: () => Promise<T>): Promise<T> {
    this.saving = true;
    try { return await operation(); } finally { this.saving = false; }
  }
}

export interface AccountDeletionRecord extends Record<string, unknown> {
  schemaVersion: 1;
  uid: string;
  status: 'deleting' | 'completed';
  requestedAt: string;
  updatedAt: string;
  completedAt?: string;
  attempts: number;
  completedSteps: string[];
  deletedCounts: Record<string, number>;
  lastErrorCode?: string;
  // Pseudonymous telemetry actor, kept only while the job runs: its directory
  // entry is removed first so later events cannot be attached to this account.
  observabilityActorSubjectId?: string | null;
  workerRevision: string;
  expiresAt: string;
  leaseUntil?: string;
}

export type AccountDeletionFirestore = Pick<FirestoreServiceAccountClient,
  'getDocument' | 'getDocumentSnapshot' | 'setDocument' | 'queryDocuments' | 'listCollectionDocuments'
  | 'commitWrites' | 'deleteByStringField' | 'queryDocumentsAfter'
  | 'queryDocumentSnapshotsByNameAfter'>;

export interface AccountDeletionJobPorts {
  firestore: AccountDeletionFirestore;
  budget: AccountDeletionBudget;
  deleteTraces(): Promise<number>;
  actorSubjectId(): Promise<string | null>;
  deleteAttachments(keys: string[]): Promise<void>;
  clearQuota(name: string): Promise<void>;
  deleteAuth(): Promise<void>;
  workerRevision: string;
  now?: () => Date;
}

// Verified against owner queries in firebasePlannerRepository and Firestore Rules.
const USER_COLLECTIONS = [
  'plans', 'schedule_events', 'actuals', 'day_notes', 'month_events', 'todos',
  'study_subjects', 'study_materials', 'schedule_templates', 'timetable_terms', 'timetable_periods',
] as const;
const UID_COLLECTIONS = [
  'schedule_event_migrations', 'study_rest_days',
  'weekly_planning_personalization_profiles', 'user_planning_contexts',
] as const;

export class AccountDeletionReauthRequired extends Error {}

export async function runAccountDeletionJob(
  uid: string,
  ports: AccountDeletionJobPorts,
): Promise<'completed' | 'in_progress'> {
  const { firestore, budget } = ports;
  const now = ports.now ?? (() => new Date());
  const snapshot = await firestore.getDocumentSnapshot(ACCOUNT_DELETION_COLLECTION, uid);
  const existing = snapshot?.value;
  if (existing?.status === 'completed') return 'completed';
  // One request at a time: a concurrent request must not overwrite the
  // holder's progress, including a record the holder already completed.
  if (typeof existing?.leaseUntil === 'string' && Date.parse(existing.leaseUntil) > now().getTime()) {
    throw new AccountDeletionBusy();
  }
  const requestedAt = now().toISOString();
  const job: AccountDeletionRecord = existing
    ? { ...existing, attempts: Number(existing.attempts) + 1 } as AccountDeletionRecord
    : {
      schemaVersion: 1, uid, status: 'deleting', requestedAt, updatedAt: requestedAt,
      attempts: 1, completedSteps: [], deletedCounts: {}, workerRevision: ports.workerRevision,
      expiresAt: new Date(now().getTime() + RETENTION_MS).toISOString(),
    };
  delete job.id;
  const save = async () => {
    job.updatedAt = now().toISOString();
    await budget.save(() => firestore.setDocument(ACCOUNT_DELETION_COLLECTION, uid, job));
  };
  // The tombstone must reach Firestore before deleting any user data. This
  // conditional write also takes the lease against the version read above.
  job.leaseUntil = new Date(now().getTime() + LEASE_MS).toISOString();
  job.updatedAt = now().toISOString();
  try {
    await budget.save(() => firestore.commitWrites([{
      collection: ACCOUNT_DELETION_COLLECTION, id: uid, value: job,
      currentDocument: snapshot ? { updateTime: snapshot.updateTime } : { exists: false },
    }]));
  } catch (error) {
    if (error instanceof FirestoreWriteConflictError) throw new AccountDeletionBusy();
    throw error;
  }

  async function deleteDocuments(collection: string, ids: string[]): Promise<number> {
    await firestore.commitWrites(ids.map((id) => ({ collection, id, delete: true as const })));
    return ids.length;
  }
  async function deleteChildren(collectionPath: string): Promise<number> {
    let count = 0;
    while (true) {
      const page = await firestore.listCollectionDocuments(collectionPath, PAGE_SIZE);
      count += await deleteDocuments(collectionPath, page.map((row) => row.id));
      if (page.length < PAGE_SIZE) return count;
    }
  }
  async function deleteOwned(collection: string): Promise<number> {
    return firestore.deleteByStringField(collection, 'userId', [uid]);
  }
  async function deleteUidDocument(collection: string): Promise<number> {
    const document = await firestore.getDocument(collection, uid);
    return document ? deleteDocuments(collection, [uid]) : 0;
  }
  const savedActor = async () => job.observabilityActorSubjectId ?? null;

  // Profiles and the telemetry actor go first: trace writes require an accepted
  // policy on the profile and telemetry cannot create a new actor once the
  // tombstone exists, so a still-open device cannot refill finished steps.
  const steps: Array<{ name: string; run(): Promise<number> }> = [
    { name: 'profiles', run: () => deleteUidDocument('profiles') },
    { name: 'observability_actor_directory', async run() {
      if (!('observabilityActorSubjectId' in job)) {
        job.observabilityActorSubjectId = await ports.actorSubjectId();
        await save();
      }
      const actor = job.observabilityActorSubjectId;
      return actor ? firestore.deleteByStringField('observability_actor_directory', 'actorSubjectId', [actor]) : 0;
    } },
    { name: 'traces', run: ports.deleteTraces },
    { name: 'support_inquiries', async run() {
      let count = 0;
      while (true) {
        const page = await firestore.queryDocuments('support_inquiries', [{ field: 'userId', value: uid }], 1);
        if (page.length === 0) return count;
        const inquiry = page[0];
        // Objects use inquiry id + attachment slot, never an arbitrary client URL.
        const attachments = Array.isArray(inquiry.attachments) ? inquiry.attachments : [];
        if (attachments.length > 0) {
          budget.beforeSubrequest('firestore'); // R2 also consumes the shared Worker subrequest allowance.
          await ports.deleteAttachments(attachments.map((_, slot) => `inquiries/${String(inquiry.id)}/${slot}`));
        }
        count += await deleteDocuments('support_inquiries', [String(inquiry.id)]);
      }
    } },
    { name: 'support_inquiry_limits', run: () => deleteUidDocument('support_inquiry_limits') },
    ...USER_COLLECTIONS.map((collection) => ({ name: collection, run: () => deleteOwned(collection) })),
    { name: 'weekly_planning_approval_operations', async run() {
      let count = 0;
      while (true) {
        const page = await firestore.queryDocuments('weekly_planning_approval_operations', [{ field: 'userId', value: uid }], 1);
        if (page.length === 0) return count;
        const id = String(page[0].id);
        count += await deleteChildren(`weekly_planning_approval_operations/${id}/weekly_planning_approval_items`);
        count += await deleteDocuments('weekly_planning_approval_operations', [id]);
      }
    } },
    ...UID_COLLECTIONS.map((collection) => ({ name: collection, run: () => deleteUidDocument(collection) })),
    { name: 'class_attendance', async run() {
      let count = 0;
      const classes = `class_attendance/${uid}/classes`;
      while (true) {
        const page = await firestore.listCollectionDocuments(classes, 1);
        if (page.length === 0) break;
        const id = page[0].id;
        count += await deleteChildren(`${classes}/${id}/records`);
        count += await deleteDocuments(classes, [id]);
      }
      return count + await deleteUidDocument('class_attendance');
    } },
    { name: 'announcement_reads', async run() {
      return await deleteChildren(`announcement_reads/${uid}/items`)
        + await deleteUidDocument('announcement_reads');
    } },
    ...['observability_events', 'observability_actor_day'].map((collection) => ({
      name: collection,
      async run() {
        const actor = await savedActor();
        return actor ? firestore.deleteByStringField(collection, 'actorSubjectId', [actor]) : 0;
      },
    })),
    { name: 'observability_user_summaries', async run() {
      const actor = await savedActor();
      if (!actor) return 0;
      let count = 0;
      for (const environment of ['production', 'preview', 'development', 'test']) {
        const collection = `observability_user_summary_${environment}`;
        if (await firestore.getDocument(collection, actor)) count += await deleteDocuments(collection, [actor]);
      }
      return count;
    } },
    { name: 'observability_active_user_accumulator', async run() {
      const actor = await savedActor();
      if (!actor) return 0;
      // The 64 shared accumulator shards have no expiry: remove only this actor's
      // line, with an update-time precondition to protect a concurrent scan.
      const collection = 'observability_active_user_snapshot_accumulator';
      const shards = await firestore.queryDocumentSnapshotsByNameAfter({ collection, limit: 100 });
      let count = 0;
      for (const shard of shards) {
        const flags = shard.value.actorFlags;
        if (typeof flags !== 'string') continue;
        const lines = flags.split('\n');
        const retained = lines.filter((line) => line.slice(0, line.lastIndexOf(':')) !== actor);
        if (retained.length === lines.length) continue;
        await firestore.commitWrites([{
          collection, id: shard.id, value: { actorFlags: retained.join('\n') },
          updateMask: ['actorFlags'], currentDocument: { updateTime: shard.updateTime },
        }]);
        count += 1;
      }
      return count;
    } },
    { name: 'quota', async run() {
      // These names exactly match index.ts/worker.ts and productObservabilityApi.ts.
      for (const name of [`uid:${encodeURIComponent(uid.trim()).slice(0, 160)}`, `telemetry:uid:${encodeURIComponent(uid)}`]) {
        budget.beforeSubrequest('firestore'); // DO RPCs share the invocation allowance.
        await ports.clearQuota(name);
      }
      return 0;
    } },
    { name: 'auth', async run() { await ports.deleteAuth(); return 1; } },
  ];

  try {
    for (const step of steps) {
      if (job.completedSteps.includes(step.name)) continue;
      if (budget.snapshot().attemptedSubrequests >= 38) throw new AccountDeletionYield();
      const count = await step.run();
      job.completedSteps.push(step.name);
      job.deletedCounts[step.name] = (job.deletedCounts[step.name] ?? 0) + count;
      delete job.lastErrorCode;
      await save();
    }
    job.status = 'completed';
    delete job.observabilityActorSubjectId;
    delete job.leaseUntil;
    job.completedAt = now().toISOString();
    job.expiresAt = new Date(now().getTime() + RETENTION_MS).toISOString();
    await save();
    return 'completed';
  } catch (error) {
    delete job.leaseUntil;
    if (error instanceof AccountDeletionYield) {
      await save();
      return 'in_progress';
    }
    job.lastErrorCode = error instanceof AccountDeletionReauthRequired
      ? 'account_deletion_reauth_required' : 'account_deletion_retryable';
    await save();
    throw error;
  }
}

// Job expiresAt is an ISO string (the existing codec treats expireAt as a
// timestamp). Keep its query boundary string-typed and guard concurrent updates.
export async function sweepExpiredAccountDeletions(
  firestore: Pick<AccountDeletionFirestore, 'queryDocumentsAfter' | 'commitWrites'>,
  now = new Date(),
): Promise<number> {
  const rows = await firestore.queryDocumentsAfter({
    collection: ACCOUNT_DELETION_COLLECTION, orderByField: 'expiresAt', limit: 100,
    endAtString: now.toISOString(),
  });
  const expired = rows.filter((row) => typeof row.expiresAt === 'string'
    && Number.isFinite(Date.parse(row.expiresAt)) && Date.parse(row.expiresAt) <= now.getTime());
  await firestore.commitWrites(expired.map((row) => ({
    collection: ACCOUNT_DELETION_COLLECTION, id: row.id, delete: true as const,
    ...(row.updateTime ? { currentDocument: { updateTime: row.updateTime } } : {}),
  })));
  return expired.length;
}
