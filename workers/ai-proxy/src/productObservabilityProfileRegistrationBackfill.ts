import {
  PROFILE_REGISTERED_AT_ISO_FIELD,
  normalizeProfileRegistrationTimestamp,
} from '../../../shared/profileRegistrationTime';
import {
  FirestoreServiceAccountClient,
  type FirestoreOrderedCursor,
  type FirestoreOrderedDocument,
  type FirestoreServiceAccountEnv,
} from './firestoreServiceAccountClient';

export const PROFILE_REGISTRATION_BACKFILL_STATE_COLLECTION =
  'observability_profile_registration_backfill_state';
export const PROFILE_REGISTRATION_BACKFILL_STATE_ID = 'main';

const PROFILE_COLLECTION = 'profiles';
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 250;
const BACKFILL_SCHEMA_VERSION = 1 as const;

export interface ProfileRegistrationBackfillCheckpoint {
  schemaVersion: typeof BACKFILL_SCHEMA_VERSION;
  cursor: FirestoreOrderedCursor | null;
  processedProfiles: number;
  normalizedProfiles: number;
  malformedProfiles: number;
  completed: boolean;
  updatedAt: string;
}

interface ProfileRegistrationBackfillFirestore {
  getDocument(collection: string, id: string): Promise<Record<string, unknown> | null>;
  setDocument(
    collection: string,
    id: string,
    value: Record<string, unknown>,
    updateMask?: string[],
  ): Promise<void>;
  queryDocumentsAfter(params: {
    collection: string;
    orderByField: string;
    cursor?: FirestoreOrderedCursor | null;
    limit?: number;
  }): Promise<FirestoreOrderedDocument[]>;
}

export interface ProductObservabilityProfileRegistrationBackfillEnv
  extends FirestoreServiceAccountEnv {}

function emptyCheckpoint(nowIso: string): ProfileRegistrationBackfillCheckpoint {
  return {
    schemaVersion: BACKFILL_SCHEMA_VERSION,
    cursor: null,
    processedProfiles: 0,
    normalizedProfiles: 0,
    malformedProfiles: 0,
    completed: false,
    updatedAt: nowIso,
  };
}

function readCheckpoint(
  value: Record<string, unknown> | null,
  nowIso: string,
): ProfileRegistrationBackfillCheckpoint {
  if (!value) return emptyCheckpoint(nowIso);
  let cursor: FirestoreOrderedCursor | null = null;
  if (value.cursor !== null && value.cursor !== undefined) {
    if (!value.cursor || typeof value.cursor !== 'object') {
      throw new Error('profile_registration_backfill_checkpoint_invalid');
    }
    const record = value.cursor as Record<string, unknown>;
    if (typeof record.orderedValue !== 'string' || typeof record.documentName !== 'string') {
      throw new Error('profile_registration_backfill_checkpoint_invalid');
    }
    cursor = {
      orderedValue: record.orderedValue,
      documentName: record.documentName,
    };
  }
  if (
    value.schemaVersion !== BACKFILL_SCHEMA_VERSION
    || !Number.isSafeInteger(value.processedProfiles)
    || Number(value.processedProfiles) < 0
    || !Number.isSafeInteger(value.normalizedProfiles)
    || Number(value.normalizedProfiles) < 0
    || !Number.isSafeInteger(value.malformedProfiles)
    || Number(value.malformedProfiles) < 0
    || typeof value.completed !== 'boolean'
  ) {
    throw new Error('profile_registration_backfill_checkpoint_invalid');
  }
  return {
    schemaVersion: BACKFILL_SCHEMA_VERSION,
    cursor,
    processedProfiles: Number(value.processedProfiles),
    normalizedProfiles: Number(value.normalizedProfiles),
    malformedProfiles: Number(value.malformedProfiles),
    completed: value.completed,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : nowIso,
  };
}

function nextCursor(row: FirestoreOrderedDocument): FirestoreOrderedCursor {
  if (typeof row.createdAt !== 'string') {
    throw new Error('profile_registration_backfill_profile_invalid');
  }
  return {
    orderedValue: row.createdAt,
    documentName: row.documentName,
  };
}

export function profileRegistrationBackfillReady(
  checkpoint: ProfileRegistrationBackfillCheckpoint | null,
): boolean {
  return Boolean(checkpoint?.completed && checkpoint.malformedProfiles === 0);
}

export class ProductObservabilityProfileRegistrationBackfillService {
  constructor(
    env: ProductObservabilityProfileRegistrationBackfillEnv,
    private readonly firestore: ProfileRegistrationBackfillFirestore =
      new FirestoreServiceAccountClient(env),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async checkpoint(): Promise<ProfileRegistrationBackfillCheckpoint | null> {
    const value = await this.firestore.getDocument(
      PROFILE_REGISTRATION_BACKFILL_STATE_COLLECTION,
      PROFILE_REGISTRATION_BACKFILL_STATE_ID,
    );
    return value ? readCheckpoint(value, this.now().toISOString()) : null;
  }

  async runBatch(limit = DEFAULT_BATCH_SIZE): Promise<ProfileRegistrationBackfillCheckpoint> {
    const nowIso = this.now().toISOString();
    const current = readCheckpoint(
      await this.firestore.getDocument(
        PROFILE_REGISTRATION_BACKFILL_STATE_COLLECTION,
        PROFILE_REGISTRATION_BACKFILL_STATE_ID,
      ),
      nowIso,
    );
    if (current.completed) return current;

    const pageSize = Math.max(1, Math.min(MAX_BATCH_SIZE, Math.floor(limit)));
    const rows = await this.firestore.queryDocumentsAfter({
      collection: PROFILE_COLLECTION,
      orderByField: 'createdAt',
      cursor: current.cursor,
      limit: pageSize,
    });
    rows.forEach(nextCursor);

    let normalizedProfiles = current.normalizedProfiles;
    let malformedProfiles = current.malformedProfiles;
    for (const row of rows) {
      const existingRegisteredAt = normalizeProfileRegistrationTimestamp(
        row[PROFILE_REGISTERED_AT_ISO_FIELD],
      );
      if (existingRegisteredAt) continue;

      const normalized = normalizeProfileRegistrationTimestamp(row.createdAt);
      if (!normalized) {
        malformedProfiles += 1;
        continue;
      }
      await this.firestore.setDocument(
        PROFILE_COLLECTION,
        row.id,
        { [PROFILE_REGISTERED_AT_ISO_FIELD]: normalized },
        [PROFILE_REGISTERED_AT_ISO_FIELD],
      );
      normalizedProfiles += 1;
    }

    const last = rows[rows.length - 1];
    const next: ProfileRegistrationBackfillCheckpoint = {
      schemaVersion: BACKFILL_SCHEMA_VERSION,
      cursor: last ? nextCursor(last) : current.cursor,
      processedProfiles: current.processedProfiles + rows.length,
      normalizedProfiles,
      malformedProfiles,
      completed: rows.length < pageSize,
      updatedAt: nowIso,
    };
    await this.firestore.setDocument(
      PROFILE_REGISTRATION_BACKFILL_STATE_COLLECTION,
      PROFILE_REGISTRATION_BACKFILL_STATE_ID,
      next as unknown as Record<string, unknown>,
    );
    return next;
  }
}
