import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const API = 'https://firestore.googleapis.com/v1';
const GROUP = 'sessions';
const REQUIRED = [{ fieldPath: 'deleted', order: 'ASCENDING' }, { fieldPath: 'updatedAt', order: 'ASCENDING' }];
const INTERVAL_MS = 10_000;
const MAX_CHECKS = 100;

function indexMatches(index) {
  if (index?.queryScope !== 'COLLECTION_GROUP' || !Array.isArray(index.fields)) return false;
  const fields = index.fields.filter(field => field.fieldPath !== '__name__');
  return fields.length === REQUIRED.length && fields.every((field, i) =>
    field.fieldPath === REQUIRED[i].fieldPath && field.order === REQUIRED[i].order);
}

async function ensureSourceMatches() {
  const config = JSON.parse(await fs.readFile('firestore.indexes.json', 'utf8'));
  if (config.indexes.filter(indexMatches).length !== 1
    || !config.fieldOverrides?.some(field => field.collectionGroup === GROUP && field.fieldPath === 'payload'
      && Array.isArray(field.indexes) && field.indexes.length === 0)) {
    throw new Error('The bounded conversation index and payload exemption are missing from firestore.indexes.json');
  }
}

/** Additive, idempotent Firestore Admin migration: no delete, no wildcard index deployment. */
export async function ensureConversationFirestoreIndexes({ projectId, accessToken, request = fetch,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)), checks = MAX_CHECKS, verifyOnly = false,
  validateSource = true } = {}) {
  if (!/^[a-z][a-z0-9-]{5,62}$/.test(projectId ?? '') || !accessToken) throw new Error('Valid project ID and OAuth access token required');
  if (validateSource) await ensureSourceMatches();
  const base = `projects/${projectId}/databases/(default)/collectionGroups/${GROUP}`;
  const call = async (path, method = 'GET', body) => {
    const response = await request(`${API}/${path}`, { method,
      headers: { Authorization: `Bearer ${accessToken}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.status === 404 && method === 'GET') return null;
    if (!response.ok) throw new Error(`Firestore Admin ${method} failed (${response.status}): ${(await response.text()).slice(0, 250)}`);
    return response.json();
  };
  const allIndexes = async () => {
    const result = []; let pageToken = '';
    do {
      const page = await call(`${base}/indexes?pageSize=100${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`);
      if (!page) throw new Error('Firestore index listing missing');
      result.push(...(page.indexes ?? []));
      pageToken = page.nextPageToken || '';
      if (result.length > 10_000) throw new Error('Firestore index pagination limit');
    } while (pageToken);
    return result;
  };
  let matching = (await allIndexes()).filter(indexMatches);
  if (matching.length > 1) throw new Error('Duplicate matching conversation indexes need owner review');
  if (!matching.length) {
    if (verifyOnly) throw new Error('Required Firestore conversation composite index is absent');
    await call(`${base}/indexes`, 'POST', { queryScope: 'COLLECTION_GROUP', fields: REQUIRED });
  }
  const fieldName = `${base}/fields/payload`;
  let field = await call(fieldName);
  const explicitlyDisabled = value => value?.indexConfig && value.indexConfig.usesAncestorConfig !== true
    && (!Array.isArray(value.indexConfig.indexes) || value.indexConfig.indexes.length === 0);
  if (!explicitlyDisabled(field)) {
    if (verifyOnly) throw new Error('Conversation payload still has inherited or enabled indexes');
    // Only the single-field index config is updated. Never touch TTL or other fields.
    await call(`${fieldName}?updateMask=indexConfig`, 'PATCH', { name: fieldName, indexConfig: { indexes: [] } });
  }
  for (let attempt = 0; attempt < checks; attempt++) {
    matching = (await allIndexes()).filter(indexMatches);
    if (matching.length > 1 || (matching.length === 0 && verifyOnly)) throw new Error('Firestore index count changed unexpectedly');
    if (matching[0]?.state === 'ERROR') throw new Error('Firestore conversation index creation failed');
    field = await call(fieldName);
    if (matching[0]?.state === 'READY' && explicitlyDisabled(field)) {
      return { indexName: matching[0].name, indexState: matching[0].state, fieldName, fieldIndexed: false };
    }
    if (verifyOnly) throw new Error(`Firestore index not ready: ${matching[0]?.state ?? 'missing'}`);
    if (attempt + 1 < checks) await pause(INTERVAL_MS);
  }
  throw new Error('Firestore conversation index not READY; do not deploy Rules yet');
}

const INDEX_PERMISSIONS = ['datastore.indexes.list', 'datastore.indexes.get', 'datastore.indexes.create', 'datastore.indexes.update'];

/** Read-only: report the token's principal and which index permissions IAM grants it in the project. */
export async function describeIndexPermissions({ projectId, accessToken, request = fetch }) {
  const lines = [];
  try {
    const info = await request(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
    const body = await info.json();
    lines.push(`Token principal: ${body.email ?? body.azp ?? 'unknown'}; scopes: ${body.scope ?? 'unknown'}`);
  } catch (error) { lines.push(`Token principal lookup failed: ${error instanceof Error ? error.message : error}`); }
  try {
    const response = await request(`https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}:testIamPermissions`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: INDEX_PERMISSIONS }) });
    if (!response.ok) lines.push(`testIamPermissions failed (${response.status}): ${(await response.text()).slice(0, 250)}`);
    else {
      const granted = (await response.json()).permissions ?? [];
      lines.push(`Granted on ${projectId}: ${granted.join(', ') || 'none'}`);
      lines.push(`Missing on ${projectId}: ${INDEX_PERMISSIONS.filter(p => !granted.includes(p)).join(', ') || 'none'}`);
    }
  } catch (error) { lines.push(`testIamPermissions request failed: ${error instanceof Error ? error.message : error}`); }
  return lines;
}

async function main() {
  const options = { projectId: process.env.GCP_PROJECT_ID, accessToken: process.env.GOOGLE_OAUTH_ACCESS_TOKEN };
  let result;
  try {
    result = await ensureConversationFirestoreIndexes({ ...options, verifyOnly: process.argv.includes('--verify-only') });
  } catch (error) {
    if (error instanceof Error && error.message.includes('(403)')) {
      for (const line of await describeIndexPermissions(options)) console.error(line);
    }
    throw error;
  }
  console.log(`Conversation retention index READY (${result.indexName}); payload indexing disabled (${result.fieldName}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
