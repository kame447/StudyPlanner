import {
  FirestoreServiceAccountClient,
  type FirestoreServiceAccountEnv,
} from './firestoreServiceAccountClient';

export type WeeklyPlanningTraceFirestoreEnv = FirestoreServiceAccountEnv;

export class WeeklyPlanningTraceFirestoreClient extends FirestoreServiceAccountClient {
  override async setImmutableDocument(
    collection: string,
    id: string,
    value: Record<string, unknown>,
  ): Promise<void> {
    await super.setImmutableDocument(
      collection,
      id,
      value,
      'immutable trace document conflict',
    );
  }

  async commitTraceAppend(params: {
    entryCollection: string;
    entries: Array<{ id: string; value: Record<string, unknown> }>;
    sessionCollection: string;
    sessionId: string;
    sessionValue: Record<string, unknown>;
    maximumFieldPath: string;
    maximum: number;
  }): Promise<void> {
    await this.commitImmutableBatchWithMaximum({
      itemCollection: params.entryCollection,
      items: params.entries,
      aggregateCollection: params.sessionCollection,
      aggregateId: params.sessionId,
      aggregateValue: params.sessionValue,
      maximumFieldPath: params.maximumFieldPath,
      maximum: params.maximum,
      writeFailurePrefix: 'Firestore atomic trace append failed',
      conflictMessage: 'immutable trace document conflict: atomic append',
    });
  }
}
