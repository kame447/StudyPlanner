import { describe, expect, it } from 'vitest';
import {
  mergeInferredUserPlanningContextRecordsV1,
  migrateLocalUserPlanningContextSnapshotV1,
  removeUserPlanningContextRecordFromSnapshotV1,
  replaceWithUserConfirmedContextRecordV1,
} from './userPlanningContextRepository';
import {
  createEmptyUserPlanningContextSnapshotV1,
  type UserPlanningContextRecordV1,
} from './userPlanningContextTypes';

const OWNER = 'owner-a';

function record(overrides: Partial<UserPlanningContextRecordV1> = {}): UserPlanningContextRecordV1 {
  return {
    id: 'record-1',
    ownerId: OWNER,
    kind: 'study_goal',
    label: '第一志望',
    value: '国公立大学の理系',
    dateExpression: null,
    observedDate: '2026-08-28',
    resolvedDate: null,
    sourceText: '国公立大学の理系を志望しています',
    sourceConversationId: 'conversation-1',
    sourceTurnId: 'turn-1',
    recordedAt: '2026-08-28T00:00:00.000Z',
    status: 'active',
    origin: 'ai_inferred',
    ...overrides,
  };
}

describe('userPlanningContextRepository merge policy', () => {
  it('migrates legacy/local inferred records without pretending they are user-confirmed', () => {
    const snapshot = {
      ...createEmptyUserPlanningContextSnapshotV1(OWNER),
      records: [record()],
    };

    expect(migrateLocalUserPlanningContextSnapshotV1(snapshot).records[0]?.origin)
      .toBe('migration');
  });

  it('never lets an inferred memory overwrite a user-confirmed value with the same durable key', () => {
    const confirmed = record({
      id: 'confirmed',
      value: '静岡大学情報学部',
      origin: 'user_confirmed',
    });
    const snapshot = {
      ...createEmptyUserPlanningContextSnapshotV1(OWNER),
      records: [confirmed],
    };
    const inferred = record({
      id: 'inferred',
      value: '別の大学',
      origin: 'ai_inferred',
      recordedAt: '2026-08-29T00:00:00.000Z',
    });

    const merged = mergeInferredUserPlanningContextRecordsV1({
      snapshot,
      records: [inferred],
      now: '2026-08-29T00:00:01.000Z',
    });

    expect(merged.records).toHaveLength(1);
    expect(merged.records[0]).toMatchObject({
      id: 'confirmed',
      value: '静岡大学情報学部',
      origin: 'user_confirmed',
    });
  });

  it('preserves distinct inferred concern history while deduplicating an exact repeated concern', () => {
    const firstConcern = record({
      id: 'concern-1',
      kind: 'concern',
      label: '数学',
      value: '理解に不安がある',
      sourceText: '数学は理解に不安があります',
    });
    const snapshot = {
      ...createEmptyUserPlanningContextSnapshotV1(OWNER),
      records: [firstConcern],
    };
    const secondConcern = record({
      id: 'concern-2',
      kind: 'concern',
      label: '数学',
      value: '演習で迷いやすい',
      sourceText: '数学は演習で迷いやすいです',
      sourceTurnId: 'turn-2',
      recordedAt: '2026-08-29T00:00:00.000Z',
    });
    const repeatedFirstConcern = record({
      id: 'concern-repeat',
      kind: 'concern',
      label: '数学',
      value: '理解に不安がある',
      sourceText: '今も数学は理解に不安があります',
      sourceTurnId: 'turn-3',
      recordedAt: '2026-08-30T00:00:00.000Z',
    });

    const merged = mergeInferredUserPlanningContextRecordsV1({
      snapshot,
      records: [secondConcern, repeatedFirstConcern],
      now: '2026-08-30T00:00:01.000Z',
    });

    expect(merged.records).toHaveLength(2);
    expect(merged.records.map((candidate) => candidate.value)).toEqual(expect.arrayContaining([
      '理解に不安がある',
      '演習で迷いやすい',
    ]));
    expect(merged.records.find((candidate) => candidate.value === '理解に不安がある'))
      .toMatchObject({ id: 'concern-repeat', sourceTurnId: 'turn-3' });
  });

  it('replaces an inferred record when the user edits the same durable key', () => {
    const snapshot = {
      ...createEmptyUserPlanningContextSnapshotV1(OWNER),
      records: [record()],
    };
    const confirmed = record({
      id: 'confirmed',
      value: '静岡大学情報学部',
      origin: 'user_confirmed',
    });

    const next = replaceWithUserConfirmedContextRecordV1({
      snapshot,
      record: confirmed,
      now: '2026-08-29T00:00:00.000Z',
    });

    expect(next.records).toHaveLength(1);
    expect(next.records[0]).toMatchObject({
      id: 'confirmed',
      value: '静岡大学情報学部',
      origin: 'user_confirmed',
    });
  });

  it('removes a shared memory explicitly instead of leaving a second local truth', () => {
    const snapshot = {
      ...createEmptyUserPlanningContextSnapshotV1(OWNER),
      records: [record()],
    };

    const next = removeUserPlanningContextRecordFromSnapshotV1({
      snapshot,
      recordId: 'record-1',
      now: '2026-08-29T00:00:00.000Z',
    });

    expect(next.records).toEqual([]);
  });
});
