import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { classifyFirestoreWrite, runProductionSmoke } from '../tests/e2e/support/d5-production-smoke-observation.mjs';
import { persistRedactedSmokeEvidence, redactedSmokeEvidence } from '../tests/e2e/support/d5-production-readonly.mjs';

const database = 'projects/fixture/databases/(default)';
const documents = `${database}/documents`;
const channel = `https://firestore.googleapis.com/google.firestore.v1.Firestore/Write/channel?database=${database}`;
const name = collection => `${documents}/${collection}/PRIVATE_DOCUMENT_SENTINEL`;
const update = collection => ({ update: { name: name(collection), fields: { text: { stringValue: 'PRIVATE_USER_TEXT' } } } });
const form = (...messages) => new URLSearchParams({ count: String(messages.length), ofs: '123',
  ...Object.fromEntries(messages.map((message, index) => [`req${index}___data__`, JSON.stringify(message)])),
}).toString();
const classify = (body, url = channel, method = 'POST') => classifyFirestoreWrite({ url, method, postData: body });
const writes = (...entries) => ({ streamToken: 'PRIVATE_STREAM_TOKEN', writes: entries });

describe('production Firestore write scope', () => {
  it.each(['schedule_events', 'plans', 'month_events', 'weekly_planning_approval_operations', 'weekly_planning_approval_items', 'actuals'])('rejects a %s mutation and exports collection ids only', collection => {
    const observed = classify(form(writes(update(collection))));
    expect(observed).toEqual({ transport: 'write_channel', classification: 'forbidden', collections: [collection] });
    expect(JSON.stringify(observed)).not.toMatch(/PRIVATE_|projects|https:/u);
  });
  it.each(['update', 'delete', 'transform'])('finds the actual document target for %s', operation => {
    const write = operation === 'update' ? update('plans') : operation === 'delete'
      ? { delete: name('plans') } : { transform: { document: name('plans'), fieldTransforms: [] } };
    expect(classify(form(writes(write))).classification).toBe('forbidden');
  });
  it('detects nested approval-item writes and mixed allowed/forbidden batches', () => {
    const nested = { delete: `${name('weekly_planning_approval_operations')}/weekly_planning_approval_items/PRIVATE_CHILD` };
    expect(classify(form(writes(update('profiles'), nested)))).toEqual({
      transport: 'write_channel', classification: 'forbidden',
      collections: ['profiles', 'weekly_planning_approval_items', 'weekly_planning_approval_operations'],
    });
  });
  it.each(['profiles'])('records explicitly allowed root %s writes, never silently discards them', collection => {
    expect(classify(form(writes(update(collection))))).toEqual({ transport: 'write_channel', classification: 'allowed', collections: [collection] });
  });
  it.each(['weekly_planning_trace_sessions', 'weekly_planning_trace_entries'])('fails direct writes to production-denied %s', collection => {
    expect(classify(form(writes(update(collection))))).toEqual({ transport: 'write_channel', classification: 'unclassified', collections: [collection] });
  });
  it('rejects unknown collections, nested children under an allowed root, and malformed mutations', () => {
    for (const write of [update('PRIVATE_UNKNOWN_COLLECTION'),
      { delete: `${name('profiles')}/weekly_planning_trace_entries/PRIVATE_CHILD` },
      { update: { fields: {} } }, {}, { update: update('profiles').update, delete: name('profiles') }]) {
      const observed = classify(form(writes(write)));
      expect(observed.classification).toBe('unclassified');
      expect(JSON.stringify(observed)).not.toContain('PRIVATE_');
    }
  });
  it.each(['commit', 'batchWrite'])('classifies REST %s JSON bodies including document transforms', rpc => {
    expect(classify(JSON.stringify(writes({ transform: { document: name('schedule_events') } })),
      `https://firestore.googleapis.com/v1/${documents}:${rpc}`)).toEqual({
      transport: rpc === 'commit' ? 'commit' : 'batch_write', classification: 'forbidden', collections: ['schedule_events'],
    });
  });
  it.each(['PATCH', 'PUT', 'DELETE'])('rejects a direct REST %s schedule write', method => {
    expect(classify('{}', `https://firestore.googleapis.com/v1/${name('plans')}`, method).classification).toBe('forbidden');
  });
  it('classifies REST createDocument from the parent path, not arbitrary fields', () => {
    expect(classify('{"fields":{}}', `https://firestore.googleapis.com/v1/${documents}/plans?documentId=PRIVATE_ID`).classification).toBe('forbidden');
    expect(classify('{"fields":{}}', `https://firestore.googleapis.com/v1/${documents}/profiles`).classification).toBe('allowed');
  });
  it('distinguishes documented SDK handshake, token-only, poll and empty-drain messages from writes', () => {
    for (const body of [form({ database }), form({ streamToken: 'PRIVATE_TOKEN' }), form(writes()), form()]) {
      expect(classify(body)).toEqual({ transport: 'write_channel', classification: 'protocol', collections: [] });
    }
    expect(classify(null, `${channel}&RID=rpc`, 'GET').classification).toBe('protocol');
    expect(classify(null, `${channel}&TYPE=terminate`, 'GET').classification).toBe('protocol');
  });
  it('accepts an authenticated SDK handshake without exporting the opaque headers', () => {
    const headers = new URLSearchParams({ headers: 'Authorization: Bearer PRIVATE_AUTH_TOKEN\r\nX-Goog-AppCheck: PRIVATE_APP_CHECK\r\n' });
    const observed = classify(`${headers}&${form({ database })}`);
    expect(observed).toEqual({ transport: 'write_channel', classification: 'protocol', collections: [] });
    const evidence = redactedSmokeEvidence({ firestoreWrites: [observed] });
    expect(JSON.stringify(evidence)).not.toMatch(/PRIVATE_|Authorization|AppCheck|Bearer|headers/u);
  });
  it('still inspects every mutation after authenticated handshake headers, including mixed batches', () => {
    const headers = new URLSearchParams({ headers: 'Authorization: Bearer PRIVATE_AUTH_TOKEN' });
    const observed = classify(`${headers}&${form({ database }, writes(update('profiles'), update('plans')))}`);
    expect(observed).toEqual({ transport: 'write_channel', classification: 'forbidden', collections: ['plans', 'profiles'] });
    expect(JSON.stringify(observed)).not.toMatch(/PRIVATE_|headers|Bearer/u);
  });
  it('does not let opaque headers bypass unknown fields, malformed messages or duplicate metadata', () => {
    const headers = new URLSearchParams({ headers: 'PRIVATE_AUTH_TOKEN' });
    for (const body of [`${headers}&${form({ database })}&opaque=PRIVATE_PAYLOAD`,
      `${headers}&count=1&req0___data__=not-json`, `${headers}&${headers}&${form({ database })}`]) {
      expect(classify(body).classification).toBe('unclassified');
    }
  });
  it('inspects every message in a WebChannel batch after its handshake', () => {
    expect(classify(form({ database }, writes(update('plans')))).classification).toBe('forbidden');
  });
  it.each([null, '', 'not-json', '{}', 'count=1&req0___data__=not-json', 'count=2&req0___data__=%7B%7D',
    'count=0&req0___data__=%7B%7D', 'count=1&req1___data__=%7B%7D', 'count=0&opaque=PRIVATE_PAYLOAD',
    'count=0&count=0', JSON.stringify({ writes: 'PRIVATE_PAYLOAD' }), JSON.stringify({ streamToken: 'token', unknownOperation: {} })])('fails closed on unclassifiable Write payload %j', body => {
    expect(classify(body).classification).toBe('unclassified');
  });
  it('does not treat a Listen/runQuery request as a write or scan user fields for fake document references', () => {
    expect(classify(form({ database }), channel.replace('/Write/', '/Listen/'))).toBeNull();
    expect(classify('{}', `https://firestore.googleapis.com/v1/${documents}:runQuery`)).toBeNull();
    expect(classify(null, `https://firestore.googleapis.com/v1/${name('plans')}`, 'GET')).toBeNull();
    expect(classify(form(writes(update('profiles')))).classification).toBe('allowed');
  });
  it('redacts even injected arbitrary values in diagnostic fields', () => {
    const redacted = redactedSmokeEvidence({ failingStep: 'PRIVATE_STEP', bodyError: { category: 'PRIVATE_CATEGORY', message: 'PRIVATE_USER_TEXT' },
      firestoreWrites: [{ transport: 'PRIVATE_URL', classification: 'PRIVATE_TOKEN', collections: ['PRIVATE_UID'] }] });
    expect(JSON.stringify(redacted)).not.toContain('PRIVATE_');
    expect(redacted.firestoreWrites[0].classification).toBe('unclassified');
  });
});

describe('original smoke failure and finalizer preservation', () => {
  it('runs both finalizers and rethrows the identical body error with bounded evidence', async () => {
    const error = Object.assign(new Error('PRIVATE_URL PRIVATE_UID PRIVATE_USER_TEXT'), { matcherResult: {} });
    const evidence = { step: 'luna_fallback', outcome: 'incomplete' };
    const readback = vi.fn(async () => { evidence.step = 'write_scope'; });
    const persist = vi.fn(async () => {});
    await expect(runProductionSmoke({ evidence, body: async () => { throw error; }, readback, persist })).rejects.toBe(error);
    expect(readback).toHaveBeenCalledOnce(); expect(persist).toHaveBeenCalledOnce();
    expect(evidence.failingStep).toBe('luna_fallback');
    expect(evidence.bodyError).toEqual({ category: 'assertion', message: 'assertion failure during Luna fallback verification.' });
    expect(JSON.stringify(redactedSmokeEvidence(evidence))).not.toContain('PRIVATE_');
  });
  it('retains body, readback and attachment failures in order with the original as cause', async () => {
    const primary = new Error('original body failure');
    const secondary = new Error('readback failure');
    const attachment = new Error('attachment failure');
    const evidence = { step: 'answer_turn', outcome: 'd5_positive_readonly_smoke' };
    let captured;
    try {
      await runProductionSmoke({ evidence, body: async () => { throw primary; },
        readback: async () => { evidence.step = 'write_scope'; throw secondary; },
        persist: async () => { throw attachment; } });
    } catch (error) { captured = error; }
    expect(captured).toBeInstanceOf(AggregateError);
    expect(captured.cause).toBe(primary); expect(captured.errors).toEqual([primary, secondary, attachment]);
    expect(evidence.outcome).toBe('incomplete'); expect(evidence.readbackStep).toBe('write_scope');
  });
  it.each(['body', 'readback', 'success'])('persists an actual redacted JSON file after %s', async failure => {
    const directory = await mkdtemp(join(tmpdir(), 'd5-error-evidence-'));
    const output = join(directory, 'redacted-d5-production-evidence.json');
    const evidence = { step: 'answer_turn', outcome: 'incomplete', firestoreWrites: [], scheduleWrites: 0, unclassifiedWrites: 0 };
    const original = new Error('PRIVATE_UID PRIVATE_USER_TEXT https://PRIVATE_URL');
    try {
      const run = runProductionSmoke({ evidence,
        body: async () => { if (failure === 'body') throw original; },
        readback: async () => { evidence.step = 'server_snapshot_after'; if (failure === 'readback') throw original; },
        persist: () => persistRedactedSmokeEvidence({ outputPath: () => output, attach: async () => {} }, evidence),
      });
      if (failure === 'success') await run; else await expect(run).rejects.toBe(original);
      const bytes = await readFile(output, 'utf8');
      expect(bytes).not.toMatch(/PRIVATE_|https:/u);
      expect(JSON.parse(bytes).bodyError != null).toBe(failure === 'body');
      expect(JSON.parse(bytes).readbackError != null).toBe(failure === 'readback');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('does not replace a timeout or non-production classification with an arbitrary raw error message', async () => {
    const evidence = { step: 'answer_turn', outcome: 'non_production' };
    const error = Object.assign(new Error('PRIVATE_TIMEOUT_CONTENT'), { name: 'TimeoutError' });
    await expect(runProductionSmoke({ evidence, body: async () => { throw error; }, readback: async () => {}, persist: async () => {} })).rejects.toBe(error);
    expect(evidence.bodyError.category).toBe('timeout'); expect(evidence.outcome).toBe('non_production');
  });
});
