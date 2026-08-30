import { describe, expect, it } from 'vitest';
import type {
  FirestoreOrderedCursor,
  FirestoreOrderedDocument,
} from './firestoreServiceAccountClient';
import {
  PROFILE_REGISTRATION_BACKFILL_STATE_COLLECTION,
  PROFILE_REGISTRATION_BACKFILL_STATE_ID,
  ProductObservabilityProfileRegistrationBackfillService,
  profileRegistrationBackfillReady,
} from './productObservabilityProfileRegistrationBackfill';

type StoredDocument = Record<string, unknown>;

class MemoryBackfillFirestore {
  readonly documents = new Map<string, StoredDocument>();
  readonly profiles: FirestoreOrderedDocument[] = [];
  readonly profileWrites: Array<{ id: string; value: StoredDocument; mask?: string[] }> = [];
  queryCallCount = 0;

  private key(collection: string, id: string): string {
    return `${collection}/${id}`;
  }

  addProfile(id: string, value: StoredDocument): void {
    this.profiles.push({
      ...value,
      id,
      documentName: `projects/test/databases/(default)/documents/profiles/${id}`,
    });
    this.profiles.sort((left, right) =>
      String(left.createdAt).localeCompare(String(right.createdAt))
      || left.documentName.localeCompare(right.documentName));
  }

  async getDocument(collection: string, id: string): Promise<StoredDocument | null> {
    const value = this.documents.get(this.key(collection, id));
    return value ? { ...value, id } : null;
  }

  async setDocument(
    collection: string,
    id: string,
    value: StoredDocument,
    updateMask?: string[],
  ): Promise<void> {
    if (collection === 'profiles') {
      const profile = this.profiles.find((row) => row.id === id);
      if (!profile) throw new Error('missing test profile');
      Object.assign(profile, value);
      this.profileWrites.push({ id, value: { ...value }, mask: updateMask });
      return;
    }
    this.documents.set(this.key(collection, id), { ...value });
  }

  async queryDocumentsAfter(params: {
    cursor?: FirestoreOrderedCursor | null;
    limit?: number;
  }): Promise<FirestoreOrderedDocument[]> {
    this.queryCallCount += 1;
    const rows = this.profiles.filter((row) => {
      if (!params.cursor) return true;
      const createdAt = String(row.createdAt ?? '');
      return createdAt > params.cursor.orderedValue
        || (createdAt === params.cursor.orderedValue
          && row.documentName > params.cursor.documentName);
    });
    return rows.slice(0, params.limit ?? 100).map((row) => ({ ...row }));
  }
}

function service(
  firestore: MemoryBackfillFirestore,
): ProductObservabilityProfileRegistrationBackfillService {
  return new ProductObservabilityProfileRegistrationBackfillService(
    {
      FIREBASE_PROJECT_ID: 'test',
      FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
      FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused',
    },
    firestore as never,
    () => new Date('2026-08-28T12:00:00.000Z'),
  );
}

describe('ProductObservabilityProfileRegistrationBackfillService', () => {
  it('normalizes legacy timestamps without overwriting already indexed profiles', async () => {
    const firestore = new MemoryBackfillFirestore();
    firestore.addProfile('a', {
      createdAt: 'Fri, 28 Aug 2026 10:00:00 GMT',
    });
    firestore.addProfile('b', {
      createdAt: '2026-08-28T11:00:00.000Z',
      registeredAt: '2026-08-28T11:00:00.000Z',
    });

    const checkpoint = await service(firestore).runBatch(10);

    expect(checkpoint).toMatchObject({
      processedProfiles: 2,
      normalizedProfiles: 1,
      malformedProfiles: 0,
      completed: true,
    });
    expect(profileRegistrationBackfillReady(checkpoint)).toBe(true);
    expect(firestore.profileWrites).toEqual([{
      id: 'a',
      value: { registeredAt: '2026-08-28T10:00:00.000Z' },
      mask: ['registeredAt'],
    }]);
    expect(firestore.documents.get(
      `${PROFILE_REGISTRATION_BACKFILL_STATE_COLLECTION}/${PROFILE_REGISTRATION_BACKFILL_STATE_ID}`,
    )).toMatchObject({ completed: true, malformedProfiles: 0 });
  });

  it('advances in bounded pages and completes only after reaching the end', async () => {
    const firestore = new MemoryBackfillFirestore();
    firestore.addProfile('a', { createdAt: '2026-08-26T00:00:00.000Z' });
    firestore.addProfile('b', { createdAt: '2026-08-27T00:00:00.000Z' });
    firestore.addProfile('c', { createdAt: '2026-08-28T00:00:00.000Z' });
    const backfill = service(firestore);

    const first = await backfill.runBatch(2);
    expect(first).toMatchObject({ processedProfiles: 2, completed: false });
    const second = await backfill.runBatch(2);
    expect(second).toMatchObject({ processedProfiles: 3, completed: true });
    expect(firestore.profileWrites).toHaveLength(3);
  });

  it('keeps the registration index unready when a legacy timestamp is malformed', async () => {
    const firestore = new MemoryBackfillFirestore();
    firestore.addProfile('bad', { createdAt: 'not-a-date' });

    const checkpoint = await service(firestore).runBatch(10);

    expect(checkpoint).toMatchObject({
      processedProfiles: 1,
      normalizedProfiles: 0,
      malformedProfiles: 1,
      completed: true,
    });
    expect(profileRegistrationBackfillReady(checkpoint)).toBe(false);
    expect(firestore.profileWrites).toEqual([]);
  });

  it('fails closed on a malformed persisted cursor instead of restarting from the beginning', async () => {
    const firestore = new MemoryBackfillFirestore();
    firestore.documents.set(
      `${PROFILE_REGISTRATION_BACKFILL_STATE_COLLECTION}/${PROFILE_REGISTRATION_BACKFILL_STATE_ID}`,
      {
        schemaVersion: 1,
        cursor: { orderedValue: 123, documentName: 'bad' },
        processedProfiles: 10,
        normalizedProfiles: 10,
        malformedProfiles: 0,
        completed: false,
        updatedAt: '2026-08-28T11:00:00.000Z',
      },
    );

    await expect(service(firestore).runBatch(10)).rejects.toThrow(
      'profile_registration_backfill_checkpoint_invalid',
    );
    expect(firestore.queryCallCount).toBe(0);
  });

  it('fails before advancing the checkpoint when an ordered profile has non-string createdAt', async () => {
    const firestore = new MemoryBackfillFirestore();
    firestore.addProfile('bad-type', { createdAt: 12345 });

    await expect(service(firestore).runBatch(10)).rejects.toThrow(
      'profile_registration_backfill_profile_invalid',
    );
    expect(firestore.profileWrites).toEqual([]);
    expect(firestore.documents.has(
      `${PROFILE_REGISTRATION_BACKFILL_STATE_COLLECTION}/${PROFILE_REGISTRATION_BACKFILL_STATE_ID}`,
    )).toBe(false);
  });
});
