export interface WeeklyPlanningTraceFirestoreEnv {
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

const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKEN_EARLY_REFRESH_MS = 60_000;
const QUERY_BATCH_SIZE = 500;

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
  const normalized = pem.replace(/\\n/g, '\n');
  const base64 = normalized
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

function isIsoTimestampField(key: string): boolean {
  return key === 'expireAt';
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
    if (isIsoTimestampField(key) && Number.isFinite(new Date(value).getTime())) {
      return { timestampValue: value };
    }
    return { stringValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((item) => encodeFirestoreValue(item)) } };
  }
  if (typeof value === 'object') {
    const fields: Record<string, FirestoreValue> = {};
    Object.entries(value as Record<string, unknown>).forEach(([entryKey, entryValue]) => {
      if (entryValue !== undefined) fields[entryKey] = encodeFirestoreValue(entryValue, entryKey);
    });
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function encodeFirestoreFields(value: Record<string, unknown>): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  Object.entries(value).forEach(([key, entryValue]) => {
    if (entryValue !== undefined) fields[key] = encodeFirestoreValue(entryValue, key);
  });
  return fields;
}

function decodeFirestoreValue(value: FirestoreValue | undefined): unknown {
  if (!value || 'nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('stringValue' in value) return value.stringValue;
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
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export class WeeklyPlanningTraceFirestoreClient {
  private accessToken = '';
  private accessTokenExpiresAt = 0;

  constructor(
    private readonly env: WeeklyPlanningTraceFirestoreEnv,
    private readonly fetcher: typeof fetch = fetch,
    private readonly cryptoApi: Crypto = crypto,
  ) {}

  private projectId(): string {
    const value = this.env.FIREBASE_PROJECT_ID?.trim();
    if (!value) throw new Error('FIREBASE_PROJECT_ID is not configured');
    return value;
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

  private documentsBase(): string {
    return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.projectId())}/databases/(default)/documents`;
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

  async setImmutableDocument(
    collection: string,
    id: string,
    value: Record<string, unknown>,
  ): Promise<void> {
    const existing = await this.getDocument(collection, id);
    if (existing) {
      const normalizedExisting = { ...existing };
      delete normalizedExisting.id;
      if (stableJson(normalizedExisting) !== stableJson(value)) {
        throw new Error(`immutable trace document conflict: ${collection}/${id}`);
      }
      return;
    }
    await this.setDocument(collection, id, value);
  }

  async queryDocuments(
    collection: string,
    filters: Array<{ field: string; value: string }>,
    limit = QUERY_BATCH_SIZE,
  ): Promise<Record<string, unknown>[]> {
    const fieldFilters = filters.map((filter) => ({
      fieldFilter: {
        field: { fieldPath: filter.field },
        op: 'EQUAL',
        value: { stringValue: filter.value },
      },
    }));
    const where = fieldFilters.length === 0
      ? undefined
      : fieldFilters.length === 1
        ? fieldFilters[0]
        : { compositeFilter: { op: 'AND', filters: fieldFilters } };
    const response = await this.request(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.projectId())}/databases/(default)/documents:runQuery`,
      {
        method: 'POST',
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: collection }],
            ...(where ? { where } : {}),
            limit: Math.max(1, Math.min(QUERY_BATCH_SIZE, limit)),
          },
        }),
      },
    );
    if (!response.ok) throw new Error(`Firestore query failed: ${response.status}`);
    const payload = await response.json() as FirestoreRunQueryResult[];
    return payload.flatMap((result) => result.document
      ? [{ ...decodeFirestoreFields(result.document.fields ?? {}), id: documentId(result.document.name) }]
      : []);
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
        await Promise.all(documents.map((document) => this.deleteDocument(collection, String(document.id))));
        deleted += documents.length;
        if (documents.length < QUERY_BATCH_SIZE) break;
      }
    }
    return deleted;
  }
}
