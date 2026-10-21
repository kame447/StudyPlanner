import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { classifyFirestoreWrite, runProductionSmoke, classifyComposerReadiness, waitForProductionComposer, D5_UI_TURN_WAIT_MS, D5_UI_TEST_TIMEOUT_MS } from '../tests/e2e/support/d5-production-smoke-observation.mjs';
import { persistRedactedSmokeEvidence, redactedSmokeEvidence, observeProductionComposerState, relatedActiveEffortEstimates, productionSmokeReflectedEstimate } from '../tests/e2e/support/d5-production-readonly.mjs';
import { observeOwnAnswerTrace, observeAnswerCheckpoint } from '../tests/e2e/support/d5-production-readonly.mjs';
import { CONTROLLED_CANDIDATE_COMMIT_REJECTIONS } from '../shared/controlledCandidateCommit.ts';

describe('bounded answer failure observations', () => {
  it('keeps unread checkpoint/alert/receipt observations unknown', () => {
    expect(observeAnswerCheckpoint(null, new Set())).toEqual({ pendingTurnPresent: null, newAssistant: null, receiptConsumed: null });
    expect(observeAnswerCheckpoint({ planningState: {} }, new Set())).toEqual({ pendingTurnPresent: null, newAssistant: null, receiptConsumed: null });
    expect(redactedSmokeEvidence({}).answerPhase).toEqual({ pendingTurnPresent: null, newAssistant: null, receiptConsumed: null, alertPresent: null });
  });
  it.each([0, 1, 2])('observes %s new assistant messages independently of pending state', count => {
    const observation = observeAnswerCheckpoint({ planningState: { pendingTurn: { private: 'PRIVATE' }, messages: [
      { id: 'old', role: 'assistant', content: 'PRIVATE' }, ...Array.from({ length: count }, (_, i) => ({ id: String(i), role: 'assistant', content: 'PRIVATE' })),
    ] } }, new Set(['old']), false);
    expect(observation).toEqual({ pendingTurnPresent: true, newAssistant: ['none', 'one', 'multiple'][count], receiptConsumed: false });
    expect(JSON.stringify(redactedSmokeEvidence({ answerPhase: { ...observation, alertPresent: true, secret: 'PRIVATE' } }))).not.toContain('PRIVATE');
  });
  it.each(CONTROLLED_CANDIDATE_COMMIT_REJECTIONS)('projects the own answer rejection %s and no trace text/identifiers', reason => {
    const own = 'PRIVATE_OWN_REQUEST';
    const rows = observeOwnAnswerTrace({ entries: [{ kind: 'turn_diagnostic', requestId: own,
      diagnostics: { outcome: 'discarded_commit_rejected', error: { type: `candidate_commit_${reason}`, message: 'PRIVATE_ERROR' } },
      decision: { reason: `candidate_commit_${reason}:luna_scheduled`, secret: 'PRIVATE' }, userText: 'PRIVATE' },
    { kind: 'turn_diagnostic', requestId: 'OTHER_ACCOUNT', diagnostics: { outcome: 'failed' } }] }, new Set([own]));
    expect(rows).toEqual([{ outcome: 'discarded_commit_rejected', errorCode: `candidate_commit_${reason}`, rejectionReason: reason, fallback: 'luna_scheduled' }]);
    expect(JSON.stringify(redactedSmokeEvidence({ answerTrace: rows }))).not.toContain('PRIVATE');
  });
  it('drops unregistered strings, caps trace rows with explicit truncation and cannot match missing identities', () => {
    expect(observeOwnAnswerTrace({ entries: [{ kind: 'turn_diagnostic', diagnostics: { outcome: 'failed' } }] }, new Set())).toEqual([]);
    const redacted = redactedSmokeEvidence({ answerTrace: Array.from({ length: 20 }, () => ({ outcome: 'PRIVATE', errorCode: 'PRIVATE', rejectionReason: 'PRIVATE' })) });
    expect(redacted.answerTrace).toHaveLength(16);
    expect(redacted.answerTraceTruncated).toBe(true);
    expect(JSON.stringify(redacted)).not.toContain('PRIVATE');
  });
});

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
    expect(observed).toEqual({ transport: 'write_channel', classification: 'forbidden', operationKinds: ['update'], collections: [collection] });
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
      transport: 'write_channel', classification: 'forbidden', operationKinds: ['delete', 'update'],
      collections: ['profiles', 'weekly_planning_approval_items', 'weekly_planning_approval_operations'],
    });
  });
  it.each(['profiles'])('records explicitly allowed root %s writes, never silently discards them', collection => {
    expect(classify(form(writes(update(collection))))).toEqual({ transport: 'write_channel', classification: 'allowed', operationKinds: ['update'], collections: [collection] });
  });
  it.each(['weekly_planning_trace_sessions', 'weekly_planning_trace_entries'])('fails direct writes to production-denied %s', collection => {
    expect(classify(form(writes(update(collection))))).toEqual({ transport: 'write_channel', classification: 'unclassified', operationKinds: ['update'], collections: [collection] });
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
      transport: rpc === 'commit' ? 'commit' : 'batch_write', classification: 'forbidden', operationKinds: ['transform'], collections: ['schedule_events'],
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
      expect(classify(body)).toEqual({ transport: 'write_channel', classification: 'protocol', operationKinds: [], collections: [] });
    }
    expect(classify(null, `${channel}&RID=rpc`, 'GET').classification).toBe('protocol');
    expect(classify(null, `${channel}&TYPE=terminate`, 'GET').classification).toBe('protocol');
  });
  it('accepts an authenticated SDK handshake without exporting the opaque headers', () => {
    const headers = new URLSearchParams({ headers: 'Authorization: Bearer PRIVATE_AUTH_TOKEN\r\nX-Goog-AppCheck: PRIVATE_APP_CHECK\r\n' });
    const observed = classify(`${headers}&${form({ database })}`);
    expect(observed).toEqual({ transport: 'write_channel', classification: 'protocol', operationKinds: [], collections: [] });
    const evidence = redactedSmokeEvidence({ firestoreWrites: [observed] });
    expect(JSON.stringify(evidence)).not.toMatch(/PRIVATE_|Authorization|AppCheck|Bearer|headers/u);
  });
  it('still inspects every mutation after authenticated handshake headers, including mixed batches', () => {
    const headers = new URLSearchParams({ headers: 'Authorization: Bearer PRIVATE_AUTH_TOKEN' });
    const observed = classify(`${headers}&${form({ database }, writes(update('profiles'), update('plans')))}`);
    expect(observed).toEqual({ transport: 'write_channel', classification: 'forbidden', operationKinds: ['update'], collections: ['plans', 'profiles'] });
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
  it.each(['user_planning_contexts', 'schedule_event_migrations', 'weekly_planning_approval_operations'])('records SDK verify-only Commit for %s as read-only protocol', collection => {
    const body = { writes: [{ verify: name(collection), currentDocument: { updateTime: '2026-10-21T00:00:00.123456789Z' } }] };
    expect(classify(JSON.stringify(body), `https://firestore.googleapis.com/v1/${documents}:commit`)).toEqual({
      transport: 'commit', classification: 'protocol', operationKinds: ['verify'], collections: [collection],
    });
  });
  it('recognizes empty Commit without inventing a target and keeps empty/malformed non-Commit RPCs fail-closed', () => {
    expect(classify('{"writes":[]}', `https://firestore.googleapis.com/v1/${documents}:commit`)).toEqual({
      transport: 'commit', classification: 'protocol', operationKinds: ['empty'], collections: [],
    });
    expect(classify('{"writes":[]}', `https://firestore.googleapis.com/v1/${documents}:batchWrite`).classification).toBe('unclassified');
    expect(classify('{}', `https://firestore.googleapis.com/v1/${documents}:commit`).classification).toBe('unclassified');
  });
  it('classifies mixed verify/mutations by actual mutation targets, not the verified protected documents', () => {
    const verify = { verify: name('schedule_events'), currentDocument: { exists: true } };
    const commit = `https://firestore.googleapis.com/v1/${documents}:commit`;
    expect(classify(JSON.stringify(writes(verify, update('profiles'))), commit)).toEqual({
      transport: 'commit', classification: 'allowed', operationKinds: ['update', 'verify'], collections: ['profiles', 'schedule_events'],
    });
    expect(classify(JSON.stringify(writes(verify, update('plans'))), commit).classification).toBe('forbidden');
    expect(classify(JSON.stringify(writes(verify, update('PRIVATE_UNKNOWN'))), commit).classification).toBe('unclassified');
  });
  it.each([
    { verify: 'invalid-target', currentDocument: { exists: true } },
    { verify: name('plans'), update: update('profiles').update },
    { verify: name('plans'), updateTransforms: [] },
    { verify: name('plans'), currentDocument: { unknown: true } },
    { verify: name('plans'), currentDocument: { updateTime: 'invalid' } },
    { verify: name('plans'), currentDocument: { exists: true, updateTime: '2026-10-21T00:00:00Z' } },
  ])('does not mistake a malformed verify for protocol: %j', write => {
    expect(classify(JSON.stringify(writes(write)), `https://firestore.googleapis.com/v1/${documents}:commit`).classification).toBe('unclassified');
  });
  it('does not accept transaction-only verify through Write-channel or batchWrite', () => {
    const write = { verify: name('plans'), currentDocument: { exists: true } };
    expect(classify(form(writes(write))).classification).toBe('unclassified');
    expect(classify(JSON.stringify(writes(write)), `https://firestore.googleapis.com/v1/${documents}:batchWrite`).classification).toBe('unclassified');
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


describe('bounded production composer readiness', () => {
  const ready = { present: true, readable: true, disabled: false };
  it.each([
    [{}, 'not_present'], [ready, 'ready'], [{ ...ready, readable: false }, 'unreadable'],
    [{ ...ready, busyTurn: true, disabled: true }, 'busy_turn'],
    [{ ...ready, pendingApproval: true }, 'pending_approval'],
    [{ ...ready, approvalRecovery: true, busyTurn: true }, 'approval_recovery'],
    [{ ...ready, initializationBlocked: true }, 'chat_initialization'],
    [{ ...ready, listening: true }, 'listening'], [{ ...ready, disabled: true }, 'local_interaction_busy'],
  ])('exports only the bounded readiness reason for %j', (state, reason) => {
    expect(classifyComposerReadiness(state)).toBe(reason);
  });
  it('waits through an in-flight turn without any new submission and uses the documented observation bound', async () => {
    const evidence = {};
    const observe = vi.fn().mockResolvedValueOnce({ ...ready, disabled: true, busyTurn: true }).mockResolvedValueOnce(ready);
    await waitForProductionComposer({ evidence, phase: 'after_send', observe,
      wait: async (check, timeout) => { expect(timeout).toBe(120_000); expect(await check()).toBe(false); expect(await check()).toBe(true); },
    });
    expect(observe).toHaveBeenCalledTimes(2); expect(evidence.composerReadiness).toBe('ready');
    expect(D5_UI_TEST_TIMEOUT_MS).toBeGreaterThanOrEqual(2 * D5_UI_TURN_WAIT_MS + 180_000);
  });
  it('retains bounded busy state on timeout, original error and before/after-send phase', async () => {
    const error = new Error('PRIVATE_TIMEOUT_TEXT'); const evidence = {};
    await expect(waitForProductionComposer({ evidence, phase: 'after_send', observe: async () => ({ ...ready, disabled: true, busyTurn: true }),
      wait: async check => { expect(await check()).toBe(false); throw error; },
    })).rejects.toBe(error);
    expect(evidence).toEqual({ composerReadiness: 'busy_turn', composerWaitPhase: 'after_send' });
    expect(JSON.stringify(redactedSmokeEvidence(evidence))).not.toContain('PRIVATE_');
  });
  it('fails closed on unreadable observation, without exporting the exception or an arbitrary phase', async () => {
    const evidence = {}; const error = new Error('PRIVATE_UID https://PRIVATE_URL');
    await expect(waitForProductionComposer({ evidence, phase: 'PRIVATE_PHASE', observe: async () => { throw error; },
      wait: async check => { expect(await check()).toBe(false); throw error; },
    })).rejects.toBe(error);
    expect(evidence.composerReadiness).toBe('unreadable');
    expect(JSON.stringify(redactedSmokeEvidence(evidence))).not.toContain('PRIVATE_');
  });
  it('same-page observer reads owned checkpoint/ARIA booleans, never user text or ids', () => {
    const owner = 'PRIVATE_OWNER';
    const snapshot = { ownerId: owner, version: 'studyplanner-weekly-planning-stable-v5-session-v1',
      planningState: { pendingTurn: { requestId: 'PRIVATE_REQUEST' }, approvalRecovery: null } };
    const getItem = vi.fn(key => key.includes('.chats.') ? JSON.stringify({ activeChatId: 'PRIVATE_CHAT' }) : JSON.stringify(snapshot));
    vi.stubGlobal('localStorage', { getItem });
    vi.stubGlobal('document', { querySelector: selector => selector === '.ai-planning-composer textarea' ? { disabled: true, value: 'PRIVATE_USER_TEXT' } : null });
    try {
      const observed = observeProductionComposerState(owner);
      expect(classifyComposerReadiness(observed)).toBe('busy_turn');
      expect(JSON.stringify(observed)).not.toContain('PRIVATE_');
      snapshot.ownerId = 'FOREIGN_OWNER';
      expect(classifyComposerReadiness(observeProductionComposerState(owner))).toBe('unreadable');
    } finally { vi.unstubAllGlobals(); }
  });
});


describe('bounded active-effort diagnostics without widening the estimate oracle', () => {
  const graph = () => ({ tasks: [{ id: 'PRIVATE_MATH_TASK' }, { id: 'PRIVATE_ENGLISH_TASK' }],
    components: [{ id: 'PRIVATE_COMPONENT', taskId: 'PRIVATE_MATH_TASK' }],
    workloads: [{ id: 'PRIVATE_QUESTION', taskId: 'PRIVATE_MATH_TASK' }, { id: 'PRIVATE_OTHER_WORKLOAD', taskId: 'PRIVATE_MATH_TASK' },
      { id: 'PRIVATE_ENGLISH_WORKLOAD', taskId: 'PRIVATE_ENGLISH_TASK' }],
    effortEstimates: [], factLifecycles: [] });
  const scope = { mathTaskId: 'PRIVATE_MATH_TASK', questionTopicId: 'PRIVATE_QUESTION' };
  function add(graph, target, overrides = {}, active = true) {
    const id = `PRIVATE_ESTIMATE_${graph.effortEstimates.length}`;
    graph.effortEstimates.push({ id, taskId: scope.mathTaskId, targetFactId: target, kind: 'duration_per_unit', minutes: 15,
      unitCode: 'problem', precision: 'exact', source: { sourceText: 'PRIVATE_USER_TEXT', turnId: 'PRIVATE_TURN' }, ...overrides });
    graph.factLifecycles.push({ factId: id, status: active ? 'active' : 'superseded' });
  }
  it('distinguishes question/workload/task/component and cross-task targets; omits unrelated and inactive facts', () => {
    const value = graph();
    add(value, 'PRIVATE_QUESTION'); add(value, 'PRIVATE_OTHER_WORKLOAD'); add(value, 'PRIVATE_MATH_TASK'); add(value, 'PRIVATE_COMPONENT');
    add(value, 'PRIVATE_ENGLISH_WORKLOAD');
    add(value, 'PRIVATE_QUESTION', { taskId: 'PRIVATE_ENGLISH_TASK' });
    add(value, 'PRIVATE_ENGLISH_WORKLOAD', { taskId: 'PRIVATE_ENGLISH_TASK' });
    add(value, 'PRIVATE_QUESTION', { minutes: 99 }, false);
    const projected = relatedActiveEffortEstimates(value, scope);
    expect(projected.estimates.map(row => row.targetRelation)).toEqual(['question_topic', 'same_task_workload', 'same_task', 'same_task', 'other_task', 'other_task']);
    expect(projected.estimates.every(row => row.minutes === 15)).toBe(true);
    expect(projected.truncated).toBe(false);
    expect(JSON.stringify(projected)).not.toContain('PRIVATE_');
  });
  it.each(['exact', 'approximate', 'unspecified'])('keeps %s precision visible without treating it as exact', precision => {
    const value = graph(); add(value, 'PRIVATE_QUESTION', { precision });
    expect(relatedActiveEffortEstimates(value, scope).estimates[0]).toEqual({
      kind: 'duration_per_unit', minutes: 15, unitCode: 'problem', precision, targetRelation: 'question_topic',
    });
  });
  it('preserves different kinds, numeric values and null units for diagnosis', () => {
    const value = graph(); add(value, 'PRIVATE_QUESTION', { kind: 'total_duration', minutes: 300, unitCode: null });
    add(value, 'PRIVATE_QUESTION', { kind: 'session_duration', minutes: 15.5, unitCode: 'session' });
    expect(relatedActiveEffortEstimates(value, scope).estimates).toMatchObject([
      { kind: 'total_duration', minutes: 300, unitCode: null }, { kind: 'session_duration', minutes: 15.5, unitCode: 'session' },
    ]);
  });
  it('redacts arbitrary strings/ids/text even in known diagnostic fields, and rejects invalid numbers', () => {
    const rows = [NaN, Infinity, -1, 1_000_001, 'PRIVATE_NUMBER'].map(minutes => ({
      kind: 'PRIVATE_KIND', minutes, unitCode: 'PRIVATE_UNIT', precision: 'PRIVATE_PRECISION', targetRelation: 'PRIVATE_ID', text: 'PRIVATE_USER_TEXT',
    }));
    const exported = redactedSmokeEvidence({ relatedActiveEstimates: rows });
    expect(exported.relatedActiveEstimates.every(row => row.minutes === null && row.kind === 'unknown')).toBe(true);
    expect(JSON.stringify(exported)).not.toContain('PRIVATE_');
  });
  it('bounds both direct projection and final export, marking truncation instead of silently losing scope', () => {
    const value = graph(); for (let index = 0; index < 65; index++) add(value, 'PRIVATE_QUESTION');
    const projected = relatedActiveEffortEstimates(value, scope);
    expect(projected.estimates).toHaveLength(64); expect(projected.truncated).toBe(true);
    const exported = redactedSmokeEvidence({ relatedActiveEstimates: Array(65).fill(projected.estimates[0]) });
    expect(exported.relatedActiveEstimates).toHaveLength(64); expect(exported.relatedActiveEstimatesTruncated).toBe(true);
  });
});


describe('approved OFF precision oracle and unchanged exact D5 oracle', () => {
  const estimate = (precision = 'exact', overrides = {}) => ({ id: 'PRIVATE_ESTIMATE', targetFactId: 'PRIVATE_QUESTION',
    kind: 'duration_per_unit', minutes: 15, unitCode: 'problem', precision, ...overrides });
  const graph = (...effortEstimates) => ({ effortEstimates,
    factLifecycles: effortEstimates.map(estimate => ({ factId: estimate.id, status: 'active' })) });
  const oracle = (graph, expectation = 'EXPECT_FALLBACK') => productionSmokeReflectedEstimate(graph, { questionTopicId: 'PRIVATE_QUESTION', expectation });
  it.each(['exact', 'unspecified'])('OFF accepts a unique bound15/problem estimate with actual precision %s', precision => {
    expect(oracle(graph(estimate(precision)))).toEqual({ minutes: 15, measurement: 'duration_per_unit', unit: 'problem', precision });
  });
  it.each([
    { precision: 'approximate' }, { precision: 'unknown' }, { targetFactId: 'PRIVATE_OTHER_TARGET' },
    { minutes: 14 }, { unitCode: 'page' }, { kind: 'total_duration' },
  ])('OFF still rejects a mismatched estimate: %j', overrides => {
    expect(oracle(graph(estimate('unspecified', overrides)))).toBeNull();
  });
  it.each([
    {}, { minutes: 14 }, { unitCode: 'page' }, { precision: 'approximate' },
  ])('OFF rejects duplicate/conflicting active per-unit facts on the target: %j', conflicting => {
    expect(oracle(graph(estimate('unspecified'), estimate('exact', { id: 'PRIVATE_DUPLICATE', ...conflicting })))).toBeNull();
  });
  it('counts active facts only and does not confuse another target with this question', () => {
    const value = graph(estimate('unspecified'), estimate('exact', { id: 'PRIVATE_SUPERSEDED', minutes: 14 }),
      estimate('exact', { id: 'PRIVATE_OTHER', targetFactId: 'PRIVATE_OTHER_TARGET' }));
    value.factLifecycles[1].status = 'superseded';
    expect(oracle(value)?.precision).toBe('unspecified');
  });
  it('Jev continues to require exact precision and the original target/kind/value/unit', () => {
    expect(oracle(graph(estimate('exact')), 'EXPECT_JEV')?.precision).toBe('exact');
    expect(oracle(graph(estimate('unspecified')), 'EXPECT_JEV')).toBeNull();
    expect(oracle(graph(estimate('approximate')), 'EXPECT_JEV')).toBeNull();
    expect(oracle(graph(estimate('exact', { minutes: 14 })), 'EXPECT_JEV')).toBeNull();
    expect(oracle(graph(estimate('exact')), 'PRIVATE_MODE')).toBeNull();
  });
  it('persists the actual accepted precision rather than rewriting unspecified as exact', () => {
    const reflectedEstimate = oracle(graph(estimate('unspecified')));
    const exported = redactedSmokeEvidence({ activeEstimate: true, reflectedEstimate });
    expect(exported.reflectedEstimate?.precision).toBe('unspecified');
    expect(JSON.stringify(exported)).not.toContain('PRIVATE_');
    expect(redactedSmokeEvidence({ reflectedEstimate: { ...reflectedEstimate, precision: 'approximate' } }).reflectedEstimate).toBeNull();
  });
});
