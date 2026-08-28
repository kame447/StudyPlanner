export interface FirestoreServiceAccountEnv {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_SERVICE_ACCOUNT_EMAIL: string;
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: string;
}

interface OAuthTokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface FirestoreValue {
  nullValue?: null;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  timestampValue?: string;
  stringValue?: string;
  referenceValue?: string;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
}

interface FirestoreDocument {
  name?: string;
  fields?: Record<string, FirestoreValue>;
}

interface FirestoreRunQueryResult {
  document?: FirestoreDocument;
}

interface FirestoreRunAggregationQueryResult {
  result?: {
    aggregateFields?: Record<string, FirestoreValue>;
  };
}

interface BeginTransactionResponse {
  transaction?: string;
}

export interface FirestoreOrderedCursor {
  orderedValue: string;
  documentName: string;
}

export interface FirestoreOrderedDocument extends Record<string, unknown> {
  id: string;
  documentName: string;
}

export type FirestoreFilterOperator =
  | 'EQUAL'
  | 'GREATER_THAN'
  | 'GREATER_THAN_OR_EQUAL'
  | 'LESS_THAN'
  | 'LESS_THAN_OR_EQUAL';

export interface FirestoreStringFilter {
  field: string;
  operator: FirestoreFilterOperator;
  value: string;
  valueType?: 'string';
}

export interface FirestoreTimestampFilter {
  field: string;
  operator: FirestoreFilterOperator;
  value: string;
  valueType: 'timestamp';
}

export type FirestoreAggregationFilter = FirestoreStringFilter | FirestoreTimestampFilter;

export interface FirestoreTransactionDocumentKey {
  collection: string;
  id: string;
}

export interface FirestoreTransactionDocumentWrite extends FirestoreTransactionDocumentKey {
  value: Record<string, unknown>;
}

export class FirestoreTransactionConflictError extends Error {
  constructor(readonly status: number) {
    super(`Firestore transaction conflict: ${status}`);
    this.name = 'FirestoreTransactionConflictError';
  }
}

const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKEN_EARLY_REFRESH_MS = 60_000;
const QUERY_BATCH_SIZE = 500;
const TIMESTAMP_FIELD_NAMES = new Set(['expireAt', 'registeredAt']);
const workerSafeFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

function base64Url(value: Uint8Array | string): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';
  bytes.forEach((item) => {
    binary += String.fromCharCode(item);
  });
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  if (!base64) throw new Error('Firebase service account private key is empty');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function encodeFirestoreValue(value: unknown, key = ''): FirestoreValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { nullValue: null };
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (typeof value === 'string') {
    if (TIMESTAMP_FIELD_NAMES.has(key) && Number.isFinite(new Date(value).getTime())) {
      return { timestampValue: value };
    }
    return { stringValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((item) => encodeFirestoreValue(item)) } };
  }
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: encodeFirestoreFields(value as Record<string, unknown>),
      },
    };
  }
  return { stringValue: String(value) };
}

function encodeFirestoreFields(value: Record<string, unknown>): Record<string, FirestoreValue> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, encodeFirestoreValue(entryValue, key)]),
  );
}

function decodeFirestoreValue(value: FirestoreValue | undefined): unknown {
  if (!value || 'nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('stringValue' in value) return value.stringValue;
  if ('referenceValue' in value) return value.referenceValue;
  if ('arrayValue' in value) {
    return (value.arrayValue?.values ?? []).map(decodeFirestoreValue);
  }
  if ('mapValue' in value) {
    return decodeFirestoreFields(value.mapValue?.fields ?? {});
  }
  return null;
}

function decodeFirestoreFields(fields: Record<string, FirestoreValue>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]),
  );
}

function documentId(name: string | undefined): string {
  return name?.split('/').pop() ?? '';
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

function comparableDocument(value: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...value };
  delete normalized.id;
  delete normalized.expireAt;
  return normalized;
}

function boundedQueryLimit(limit: number): number {
  return Math.max(1, Math.min(QUERY_BATCH_SIZE, Math.floor(limit)));
}

function aggregationWhere(filters: readonly FirestoreAggregationFilter[]): object | undefined {
  const fieldFilters = filters.map((filter) => ({
    fieldFilter: {
      field: { fieldPath: filter.field },
      op: filter.operator,
      value: filter.valueType === 'timestamp'
        ? { timestampValue: filter.value }
        : { stringValue: filter.value },
    },
  }));
  if (fieldFilters.length === 0) return undefined;
  return fieldFilters.length === 1
    ? fieldFilters[0]
    : { compositeFilter: { op: 'AND', filters: fieldFilters } };
}

function equalityWhere(filters: Array<{ field: string; value: string }>): object | undefined {
  return aggregationWhere(filters.map((filter) => ({
    ...filter,
    operator: 'EQUAL' as const,
  })));
}

export class FirestoreServiceAccountClient {
  private accessToken = '';
  private accessTokenExpiresAt = 0;

  constructor(
    private readonly env: FirestoreServiceAccountEnv,
    private readonly fetcher: typeof fetch = workerSafeFetch,
    private readonly cryptoApi: Crypto = crypto,
  ) {}

  private projectId(): string {
    const value = this.env.FIREBASE_PROJECT_ID?.trim();
    if (!value) throw new Error('FIREBASE_PROJECT_ID is not configured');
    return value;
  }

  private databaseName(): string {
    return `projects/${this.projectId()}/databases/(default)`;
  }

  private documentsBase(): string {
    return `https://firestore.googleapis.com/v1/${this.databaseName()}/documents`;
  }

  private documentName(collection: string, id: string): string {
    return `${this.databaseName()}/documents/${collection}/${id}`;
  }

  private async serviceAccountToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && now + TOKEN_EARLY_REFRESH_MS < this.accessTokenExpiresAt) {
      return this.accessToken;
    }

    const email = this.env.FIREBASE_SERVICE_ACCOUNT_EMAIL?.trim();
    const privateKey = this.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim();
    if (!email || !privateKey) throw new Error('Firebase service account is not configured');

    const issuedAt = Math.floor(now / 1000);
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64Url(JSON.stringify({
      iss: email,
      sub: email,
      aud: OAUTH_TOKEN_URL,
      scope: FIRESTORE_SCOPE,
      iat: issuedAt,
      exp: issuedAt + 3600,
    }));
    const unsigned = `${header}.${claims}`;
    const key = await this.cryptoApi.subtle.importKey(
      'pkcs8',
      pemToArrayBuffer(privateKey),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await this.cryptoApi.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key,
      new TextEncoder().encode(unsigned),
    );
    const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
    const response = await this.fetcher(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!response.ok) throw new Error('Firebase service account token exchange failed');

    const payload = await response.json() as OAuthTokenResponse;
    if (!payload.access_token) throw new Error('Firebase service account token was empty');
    this.accessToken = payload.access_token;
    this.accessTokenExpiresAt = now + Math.max(60, payload.expires_in ?? 3600) * 1000;
    return this.accessToken;
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.serviceAccountToken();
    return await this.fetcher(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  }

  async getDocument(collection: string, id: string): Promise<Record<string, unknown> | null> {
    const response = await this.request(
      `${this.documentsBase()}/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Firestore get failed: ${response.status}`);
    const document = await response.json() as FirestoreDocument;
    return { ...decodeFirestoreFields(document.fields ?? {}), id: documentId(document.name) };
  }

  async getDocumentInTransaction(
    collection: string,
    id: string,
    transaction: string,
  ): Promise<Record<string, unknown> | null> {
    const params = new URLSearchParams({ transaction });
    const response = await this.request(
      `${this.documentsBase()}/${encodeURIComponent(collection)}/${encodeURIComponent(id)}?${params.toString()}`,
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Firestore transactional get failed: ${response.status}`);
    const document = await response.json() as FirestoreDocument;
    return { ...decodeFirestoreFields(document.fields ?? {}), id: documentId(document.name) };
  }

  async setDocument(
    collection: string,
    id: string,
    value: Record<string, unknown>,
    updateMask: string[] = [],
  ): Promise<void> {
    const params = new URLSearchParams();
    updateMask.forEach((field) => params.append('updateMask.fieldPaths', field));
    const query = params.size > 0 ? `?${params.toString()}` : '';
    const response = await this.request(
      `${this.documentsBase()}/${encodeURIComponent(collection)}/${encodeURIComponent(id)}${query}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ fields: encodeFirestoreFields(value) }),
      },
    );
    if (!response.ok) throw new Error(`Firestore write failed: ${response.status}`);
  }

  async setDocumentWithMaximumInteger(
    collection: string,
    id: string,
    value: Record<string, unknown>,
    fieldPath: string,
    maximum: number,
  ): Promise<void> {
    if (!Number.isSafeInteger(maximum) || maximum < 0) {
      throw new Error('Firestore maximum integer is invalid');
    }
    const updateValue = { ...value };
    delete updateValue[fieldPath];
    const response = await this.request(`${this.documentsBase()}:commit`, {
      method: 'POST',
      body: JSON.stringify({
        writes: [
          {
            update: {
              name: this.documentName(collection, id),
              fields: encodeFirestoreFields(updateValue),
            },
            updateMask: { fieldPaths: Object.keys(updateValue) },
            currentDocument: { exists: true },
          },
          {
            transform: {
              document: this.documentName(collection, id),
              fieldTransforms: [{ fieldPath, maximum: { integerValue: String(maximum) } }],
            },
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Firestore maximum transform failed: ${response.status}`);
  }

  async setImmutableDocument(
    collection: string,
    id: string,
    value: Record<string, unknown>,
    conflictMessagePrefix = 'immutable document conflict',
  ): Promise<void> {
    const params = new URLSearchParams({ documentId: id });
    const response = await this.request(
      `${this.documentsBase()}/${encodeURIComponent(collection)}?${params.toString()}`,
      {
        method: 'POST',
        body: JSON.stringify({ fields: encodeFirestoreFields(value) }),
      },
    );
    if (response.ok) return;
    if (response.status !== 409) {
      throw new Error(`Firestore immutable write failed: ${response.status}`);
    }

    const existing = await this.getDocument(collection, id);
    if (!existing
      || stableJson(comparableDocument(existing)) !== stableJson(comparableDocument(value))) {
      throw new Error(`${conflictMessagePrefix}: ${collection}/${id}`);
    }
  }

  async commitImmutableBatchWithMaximum(params: {
    itemCollection: string;
    items: Array<{ id: string; value: Record<string, unknown> }>;
    aggregateCollection: string;
    aggregateId: string;
    aggregateValue: Record<string, unknown>;
    maximumFieldPath: string;
    maximum: number;
    writeFailurePrefix?: string;
    conflictMessage?: string;
  }): Promise<void> {
    if (!Number.isSafeInteger(params.maximum) || params.maximum < 0) {
      throw new Error('Firestore maximum integer is invalid');
    }

    const aggregateValue = { ...params.aggregateValue };
    delete aggregateValue[params.maximumFieldPath];
    const writes = [
      ...params.items.map((item) => ({
        update: {
          name: this.documentName(params.itemCollection, item.id),
          fields: encodeFirestoreFields(item.value),
        },
        currentDocument: { exists: false },
      })),
      {
        update: {
          name: this.documentName(params.aggregateCollection, params.aggregateId),
          fields: encodeFirestoreFields(aggregateValue),
        },
        updateMask: { fieldPaths: Object.keys(aggregateValue) },
        currentDocument: { exists: true },
      },
      {
        transform: {
          document: this.documentName(params.aggregateCollection, params.aggregateId),
          fieldTransforms: [{
            fieldPath: params.maximumFieldPath,
            maximum: { integerValue: String(params.maximum) },
          }],
        },
      },
    ];

    const response = await this.request(`${this.documentsBase()}:commit`, {
      method: 'POST',
      body: JSON.stringify({ writes }),
    });
    if (response.ok) return;
    if (response.status !== 409) {
      const prefix = params.writeFailurePrefix ?? 'Firestore atomic append failed';
      throw new Error(`${prefix}: ${response.status}`);
    }

    const itemMatches = await Promise.all(params.items.map(async (item) => {
      const existing = await this.getDocument(params.itemCollection, item.id);
      return Boolean(existing)
        && stableJson(comparableDocument(existing as Record<string, unknown>))
          === stableJson(comparableDocument(item.value));
    }));
    const aggregate = await this.getDocument(params.aggregateCollection, params.aggregateId);
    const storedCount = Number(aggregate?.[params.maximumFieldPath] ?? -1);
    if (itemMatches.every(Boolean) && storedCount >= params.maximum) return;
    throw new Error(params.conflictMessage ?? 'immutable document conflict: atomic append');
  }

  async queryDocuments(
    collection: string,
    filters: Array<{ field: string; value: string }>,
    limit = QUERY_BATCH_SIZE,
  ): Promise<Record<string, unknown>[]> {
    const where = equalityWhere(filters);
    const response = await this.request(`${this.documentsBase()}:runQuery`, {
      method: 'POST',
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: collection }],
          ...(where ? { where } : {}),
          limit: boundedQueryLimit(limit),
        },
      }),
    });
    if (!response.ok) throw new Error(`Firestore query failed: ${response.status}`);
    const payload = await response.json() as FirestoreRunQueryResult[];
    return payload.flatMap((result) => result.document
      ? [{
          ...decodeFirestoreFields(result.document.fields ?? {}),
          id: documentId(result.document.name),
        }]
      : []);
  }

  async countDocuments(
    collection: string,
    filters: readonly FirestoreAggregationFilter[] = [],
  ): Promise<number> {
    const where = aggregationWhere(filters);
    const response = await this.request(`${this.documentsBase()}:runAggregationQuery`, {
      method: 'POST',
      body: JSON.stringify({
        structuredAggregationQuery: {
          structuredQuery: {
            from: [{ collectionId: collection }],
            ...(where ? { where } : {}),
          },
          aggregations: [{ alias: 'count', count: {} }],
        },
      }),
    });
    if (!response.ok) throw new Error(`Firestore aggregation query failed: ${response.status}`);
    const payload = await response.json() as FirestoreRunAggregationQueryResult[];
    const rawCount = payload
      .map((entry) => decodeFirestoreValue(entry.result?.aggregateFields?.count))
      .find((value) => value !== null && value !== undefined);
    if (typeof rawCount !== 'number' || !Number.isSafeInteger(rawCount) || rawCount < 0) {
      throw new Error('Firestore aggregation count was invalid');
    }
    return rawCount;
  }

  async queryDocumentsAfter(params: {
    collection: string;
    orderByField: string;
    filters?: Array<{ field: string; value: string }>;
    cursor?: FirestoreOrderedCursor | null;
    limit?: number;
  }): Promise<FirestoreOrderedDocument[]> {
    const where = equalityWhere(params.filters ?? []);
    const response = await this.request(`${this.documentsBase()}:runQuery`, {
      method: 'POST',
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: params.collection }],
          ...(where ? { where } : {}),
          orderBy: [
            { field: { fieldPath: params.orderByField }, direction: 'ASCENDING' },
            { field: { fieldPath: '__name__' }, direction: 'ASCENDING' },
          ],
          ...(params.cursor ? {
            startAt: {
              values: [
                { stringValue: params.cursor.orderedValue },
                { referenceValue: params.cursor.documentName },
              ],
              before: false,
            },
          } : {}),
          limit: boundedQueryLimit(params.limit ?? 100),
        },
      }),
    });
    if (!response.ok) throw new Error(`Firestore ordered query failed: ${response.status}`);
    const payload = await response.json() as FirestoreRunQueryResult[];
    return payload.flatMap((result) => {
      const document = result.document;
      if (!document?.name) return [];
      return [{
        ...decodeFirestoreFields(document.fields ?? {}),
        id: documentId(document.name),
        documentName: document.name,
      }];
    });
  }

  async beginTransaction(): Promise<string> {
    const response = await this.request(`${this.documentsBase()}:beginTransaction`, {
      method: 'POST',
      body: JSON.stringify({ options: { readWrite: {} } }),
    });
    if (!response.ok) throw new Error(`Firestore begin transaction failed: ${response.status}`);
    const payload = await response.json() as BeginTransactionResponse;
    if (!payload.transaction) throw new Error('Firestore transaction token was empty');
    return payload.transaction;
  }

  async commitTransaction(
    transaction: string,
    writes: readonly FirestoreTransactionDocumentWrite[],
  ): Promise<void> {
    const response = await this.request(`${this.documentsBase()}:commit`, {
      method: 'POST',
      body: JSON.stringify({
        transaction,
        writes: writes.map((write) => ({
          update: {
            name: this.documentName(write.collection, write.id),
            fields: encodeFirestoreFields(write.value),
          },
        })),
      }),
    });
    if (response.ok) return;
    if (response.status === 409 || response.status === 412) {
      throw new FirestoreTransactionConflictError(response.status);
    }
    throw new Error(`Firestore transaction commit failed: ${response.status}`);
  }

  async rollbackTransaction(transaction: string): Promise<void> {
    const response = await this.request(`${this.documentsBase()}:rollback`, {
      method: 'POST',
      body: JSON.stringify({ transaction }),
    });
    if (!response.ok) throw new Error(`Firestore transaction rollback failed: ${response.status}`);
  }

  async deleteDocument(collection: string, id: string): Promise<void> {
    const response = await this.request(
      `${this.documentsBase()}/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
    if (!response.ok && response.status !== 404) {
      throw new Error(`Firestore delete failed: ${response.status}`);
    }
  }

  async deleteByStringField(
    collection: string,
    field: string,
    values: readonly string[],
  ): Promise<number> {
    let deleted = 0;
    for (const value of values) {
      while (true) {
        const documents = await this.queryDocuments(collection, [{ field, value }]);
        if (documents.length === 0) break;
        await Promise.all(documents.map((document) =>
          this.deleteDocument(collection, String(document.id))));
        deleted += documents.length;
        if (documents.length < QUERY_BATCH_SIZE) break;
      }
    }
    return deleted;
  }
}
