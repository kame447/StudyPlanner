import { describe, expect, it } from 'vitest';
import { describeIndexPermissions, ensureConversationFirestoreIndexes } from './ensure-conversation-firestore-indexes.mjs';

const BASE = 'projects/demo-studyplanner/databases/(default)/collectionGroups/sessions';
const index = (state = 'READY') => ({ name: `${BASE}/indexes/expected`, queryScope: 'COLLECTION_GROUP', state,
  fields: [{ fieldPath: 'deleted', order: 'ASCENDING' }, { fieldPath: 'updatedAt', order: 'ASCENDING' }, { fieldPath: '__name__', order: 'ASCENDING' }] });
const unrelated = { name: `${BASE}/indexes/unrelated`, queryScope: 'COLLECTION_GROUP', state: 'READY', fields: [{fieldPath:'x',order:'ASCENDING'}] };
function backend(options = {}) {
  const calls = [];
  let exists = options.exists ?? true;
  let state = options.state ?? 'READY';
  let exempt = options.exempt ?? true;
  let updated = 0;
  const result = async (url, init) => {
    const method = init?.method ?? 'GET'; const parsed = new URL(url); const path = parsed.pathname;
    calls.push({ path, method, body: init?.body ? JSON.parse(init.body) : undefined });
    if (options.deny && method !== 'GET') return new Response('permission denied', {status:403});
    if (path.endsWith('/indexes') && method === 'GET') {
      if (options.defaultPageSizeOnly && parsed.searchParams.has('pageSize') && parsed.searchParams.get('pageSize') !== '0') {
        return Response.json({ error: { message: 'Invalid page size. Only 0 is supported.' } }, { status: 400 });
      }
      if (options.invalidList) return new Response('missing', {status:404});
      return Response.json({ indexes: [unrelated, ...(exists ? [index(state)] : [])] });
    }
    if (path.endsWith('/indexes') && method === 'POST') {
      exists = true; state = 'CREATING'; return Response.json({ name: `${BASE}/operations/index`, done: false });
    }
    if (path.endsWith('/fields/payload') && method === 'GET') {
      if (!exempt && options.fieldMissing) return new Response('', {status:404});
      return Response.json({ name: `${BASE}/fields/payload`, indexConfig: exempt
        ? { indexes: [], usesAncestorConfig: false } : { usesAncestorConfig: true, indexes:[{order:'ASCENDING'}] } });
    }
    if (path.endsWith('/fields/payload') && method === 'PATCH') {
      exempt = true; updated++; return Response.json({ name: `${BASE}/operations/field`, done: false });
    }
    throw new Error(`Unexpected ${method} ${path}`);
  };
  return { request: result, calls, setReady: () => { state = 'READY'; }, get updated() { return updated; } };
}
function opts(b, extras = {}) { return { projectId:'demo-studyplanner', accessToken:'test-token', request:b.request, checks:3, pause:async () => b.setReady(), ...extras }; }

describe('safe narrowly targeted Firestore index deployment', () => {
  it('uses the server default when production rejects nonzero pageSize', async () => {
    const b = backend({ defaultPageSizeOnly: true });
    const result = await ensureConversationFirestoreIndexes(opts(b));
    expect(result.indexState).toBe('READY');
    expect(b.calls.every(call => call.method === 'GET')).toBe(true);
  });
  it('follows and encodes returned page tokens without imposing a page size', async () => {
    const b = backend();
    const pages = [];
    const token = 'next+page/=';
    const request = async (url, init) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/indexes') && init.method === 'GET') {
        expect(parsed.searchParams.has('pageSize')).toBe(false);
        const cursor = parsed.searchParams.get('pageToken');
        pages.push(cursor);
        if (cursor === null) return Response.json({ indexes: [unrelated], nextPageToken: token });
        expect(cursor).toBe(token);
        return Response.json({ indexes: [index()] });
      }
      return b.request(url, init);
    };
    const result = await ensureConversationFirestoreIndexes(opts(b, { request }));
    expect(result.indexState).toBe('READY');
    expect(pages).toEqual([null, token, null, token]);
    expect(b.calls.every(call => call.method === 'GET')).toBe(true);
  });
  it('reads existing READY index and disabled field, never alters other indexes', async () => {
    const b = backend();
    const result = await ensureConversationFirestoreIndexes(opts(b));
    expect(result.indexState).toBe('READY'); expect(result.fieldIndexed).toBe(false);
    expect(b.calls.every(call => call.method === 'GET')).toBe(true);
  });
  it('adds only the missing composite and disables only payload indexing, then verifies readiness', async () => {
    const b = backend({ exists:false, exempt:false });
    const result = await ensureConversationFirestoreIndexes(opts(b));
    expect(result.indexState).toBe('READY');
    const writes = b.calls.filter(call => call.method !== 'GET');
    expect(writes).toEqual([
      {method:'POST',path:`/v1/${BASE}/indexes`,body:{queryScope:'COLLECTION_GROUP',fields:[{fieldPath:'deleted',order:'ASCENDING'},{fieldPath:'updatedAt',order:'ASCENDING'}]}},
      {method:'PATCH',path:`/v1/${BASE}/fields/payload`,body:{name:`${BASE}/fields/payload`,indexConfig:{indexes:[]}}},
    ]);
    expect(b.calls.some(call => call.method === 'DELETE')).toBe(false);
  });
  it('keeps an existing index pending without deploying Rules or pretending READY', async () => {
    const b = backend({ state:'CREATING' });
    await expect(ensureConversationFirestoreIndexes(opts(b,{pause:async()=>{}}))).rejects.toThrow('not READY');
    expect(b.calls.every(call => call.method === 'GET')).toBe(true);
  });
  it('verify-only fails closed before any write when index is absent', async () => {
    const b = backend({exists:false});
    await expect(ensureConversationFirestoreIndexes(opts(b,{verifyOnly:true}))).rejects.toThrow('absent');
    expect(b.calls.every(call => call.method === 'GET')).toBe(true);
  });
  it('does not bypass insufficient IAM authorization', async () => {
    const b = backend({exists:false,exempt:false,deny:true});
    await expect(ensureConversationFirestoreIndexes(opts(b))).rejects.toThrow('403');
    expect(b.calls.filter(call=>call.method!=='GET')).toHaveLength(1);
  });
  it('requires source indexes definition and never blindly mutates a missing source file', async () => {
    const b = backend();
    await expect(ensureConversationFirestoreIndexes(opts(b,{projectId:'bad'}))).rejects.toThrow('Valid project');
    expect(b.calls).toHaveLength(0);
  });
});

describe('describeIndexPermissions', () => {
  it('reports the token principal and the missing index permissions without exposing the token', async () => {
    const calls = [];
    const request = async (url, init) => {
      calls.push({ url, init });
      if (url.startsWith('https://oauth2.googleapis.com/tokeninfo')) return { json: async () => ({ email: 'deployer@p.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/cloud-platform' }) };
      return { ok: true, json: async () => ({ permissions: ['datastore.indexes.list'] }) };
    };
    const lines = await describeIndexPermissions({ projectId: 'study-planner-d1bc8', accessToken: 'secret-token', request });
    expect(lines).toEqual([
      'Token principal: deployer@p.iam.gserviceaccount.com; scopes: https://www.googleapis.com/auth/cloud-platform',
      'Granted on study-planner-d1bc8: datastore.indexes.list',
      'Missing on study-planner-d1bc8: datastore.indexes.get, datastore.indexes.create, datastore.indexes.update',
    ]);
    expect(calls[1].url).toBe('https://cloudresourcemanager.googleapis.com/v1/projects/study-planner-d1bc8:testIamPermissions');
    expect(lines.join('\n')).not.toContain('secret-token');
  });
});
