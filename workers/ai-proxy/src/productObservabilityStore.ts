import {
  PRODUCT_OBSERVABILITY_SCHEMA_VERSION,
  validateProductActivityTelemetryDraft,
  type AiRequestMetricPayload,
  type ObservabilityCorrelation,
  type ObservabilityEnvironment,
  type ProductActivityTelemetryDraft,
  type StoredObservabilityEvent,
} from '../../../shared/productObservabilityContract';
import {
  FirestoreServiceAccountClient,
  type FirestoreServiceAccountEnv,
} from './firestoreServiceAccountClient';

export interface ProductObservabilityEnv extends FirestoreServiceAccountEnv {
  OBSERVABILITY_IDENTITY_SECRET?: string;
  ENVIRONMENT?: string;
}

interface ObservabilityFirestore {
  getDocument(collection: string, id: string): Promise<Record<string, unknown> | null>;
  setImmutableDocument(
    collection: string,
    id: string,
    value: Record<string, unknown>,
    conflictMessagePrefix?: string,
  ): Promise<void>;
}

const ACTOR_DIRECTORY_COLLECTION = 'observability_actor_directory';
const EVENT_COLLECTION = 'observability_events';
const EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_CLIENT_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CLIENT_EVENT_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MIN_IDENTITY_SECRET_LENGTH = 32;

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((item) => {
    binary += String.fromCharCode(item);
  });
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function normalizedEnvironment(value: string | undefined): ObservabilityEnvironment {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'preview' || normalized === 'development' || normalized === 'test') {
    return normalized;
  }
  return 'production';
}

function comparableEvent(value: Record<string, unknown>): Record<string, unknown> {
  const comparable = { ...value };
  delete comparable.id;
  delete comparable.observedAt;
  delete comparable.expireAt;
  return comparable;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function eventsMatch(
  existing: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean {
  return stableJson(comparableEvent(existing)) === stableJson(comparableEvent(expected));
}

export class ProductObservabilityStore {
  constructor(
    private readonly env: ProductObservabilityEnv,
    private readonly firestore: ObservabilityFirestore = new FirestoreServiceAccountClient(env),
    private readonly cryptoApi: Crypto = crypto,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private identitySecret(): string {
    const value = this.env.OBSERVABILITY_IDENTITY_SECRET?.trim() ?? '';
    if (value.length < MIN_IDENTITY_SECRET_LENGTH) {
      throw new Error('OBSERVABILITY_IDENTITY_SECRET is not configured securely');
    }
    return value;
  }

  private async keyedId(prefix: string, value: string): Promise<string> {
    const key = await this.cryptoApi.subtle.importKey(
      'raw',
      new TextEncoder().encode(this.identitySecret()),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await this.cryptoApi.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(value),
    );
    return `${prefix}-${base64Url(new Uint8Array(signature))}`;
  }

  private randomActorSubjectId(): string {
    const random = typeof this.cryptoApi.randomUUID === 'function'
      ? this.cryptoApi.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
    return `actor-${random}`;
  }

  async resolveActorSubjectId(firebaseUid: string): Promise<string> {
    const uid = firebaseUid.trim();
    if (!uid) throw new Error('Authenticated Firebase UID is required');

    const directoryId = await this.keyedId('actor-directory', uid);
    const existing = await this.firestore.getDocument(ACTOR_DIRECTORY_COLLECTION, directoryId);
    const existingActor = existing?.actorSubjectId;
    if (typeof existingActor === 'string' && existingActor.trim()) {
      return existingActor;
    }

    const observedAt = this.now().toISOString();
    const actorSubjectId = this.randomActorSubjectId();
    const directoryValue = {
      schemaVersion: PRODUCT_OBSERVABILITY_SCHEMA_VERSION,
      actorSubjectId,
      createdAt: observedAt,
    };

    try {
      await this.firestore.setImmutableDocument(
        ACTOR_DIRECTORY_COLLECTION,
        directoryId,
        directoryValue,
        'observability actor directory conflict',
      );
      return actorSubjectId;
    } catch (error) {
      const raced = await this.firestore.getDocument(ACTOR_DIRECTORY_COLLECTION, directoryId);
      const racedActor = raced?.actorSubjectId;
      if (typeof racedActor === 'string' && racedActor.trim()) {
        return racedActor;
      }
      throw error;
    }
  }

  private validateClientTimestamp(occurredAt: string): void {
    const nowMs = this.now().getTime();
    const occurredAtMs = new Date(occurredAt).getTime();
    if (!Number.isFinite(occurredAtMs)) {
      throw new Error('Telemetry occurredAt is invalid');
    }
    if (occurredAtMs < nowMs - MAX_CLIENT_EVENT_AGE_MS) {
      throw new Error('Telemetry occurredAt is too old');
    }
    if (occurredAtMs > nowMs + MAX_CLIENT_EVENT_FUTURE_SKEW_MS) {
      throw new Error('Telemetry occurredAt is too far in the future');
    }
  }

  private async persistEvent(
    actorSubjectId: string,
    clientEventId: string,
    event: Record<string, unknown>,
  ): Promise<void> {
    const documentId = await this.keyedId(
      'observability-event',
      `${actorSubjectId}\n${clientEventId}`,
    );
    const existing = await this.firestore.getDocument(EVENT_COLLECTION, documentId);
    if (existing) {
      if (eventsMatch(existing, event)) return;
      throw new Error('observability event idempotency conflict');
    }

    try {
      await this.firestore.setImmutableDocument(
        EVENT_COLLECTION,
        documentId,
        event,
        'observability event conflict',
      );
    } catch (error) {
      const raced = await this.firestore.getDocument(EVENT_COLLECTION, documentId);
      if (raced && eventsMatch(raced, event)) return;
      throw error;
    }
  }

  async storeProductActivity(
    firebaseUid: string,
    input: unknown,
  ): Promise<void> {
    const validated = validateProductActivityTelemetryDraft(input);
    if (!validated.ok) throw new Error(validated.error);
    const draft: ProductActivityTelemetryDraft = validated.value;
    this.validateClientTimestamp(draft.occurredAt);

    const actorSubjectId = await this.resolveActorSubjectId(firebaseUid);
    const observedAt = this.now().toISOString();
    const event: StoredObservabilityEvent<ProductActivityTelemetryDraft['payload']> = {
      schemaVersion: PRODUCT_OBSERVABILITY_SCHEMA_VERSION,
      eventId: draft.eventId,
      eventType: 'product_activity',
      occurredAt: draft.occurredAt,
      observedAt,
      actorSubjectId,
      environment: normalizedEnvironment(this.env.ENVIRONMENT),
      appVersion: draft.appVersion,
      source: 'web_app',
      correlation: draft.correlation ?? {},
      payload: draft.payload,
      expireAt: new Date(new Date(observedAt).getTime() + EVENT_RETENTION_MS).toISOString(),
    };

    await this.persistEvent(actorSubjectId, draft.eventId, event as unknown as Record<string, unknown>);
  }

  async storeAiRequestMetric(params: {
    firebaseUid: string;
    requestId: string;
    occurredAt: string;
    appVersion: string;
    correlation?: ObservabilityCorrelation;
    payload: AiRequestMetricPayload;
  }): Promise<void> {
    const actorSubjectId = await this.resolveActorSubjectId(params.firebaseUid);
    const observedAt = this.now().toISOString();
    const event: StoredObservabilityEvent<AiRequestMetricPayload> = {
      schemaVersion: PRODUCT_OBSERVABILITY_SCHEMA_VERSION,
      eventId: params.requestId,
      eventType: 'ai_request_metric',
      occurredAt: params.occurredAt,
      observedAt,
      actorSubjectId,
      environment: normalizedEnvironment(this.env.ENVIRONMENT),
      appVersion: params.appVersion.trim() || 'unknown',
      source: 'ai_proxy',
      correlation: {
        ...(params.correlation ?? {}),
        requestId: params.requestId,
      },
      payload: params.payload,
      expireAt: new Date(new Date(observedAt).getTime() + EVENT_RETENTION_MS).toISOString(),
    };

    await this.persistEvent(
      actorSubjectId,
      params.requestId,
      event as unknown as Record<string, unknown>,
    );
  }
}
