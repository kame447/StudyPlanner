import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { selectedMaterialObservation, prepareMaterialObservation, hasMaterialObservation,
  runObservedAction, observeMaterialControl, attachMaterialObservation } from './material-pr-observation.mjs';

const options = { viewport: { width: 1920, height: 1080 }, percent: 200, contract: 'detail-cancel' };
test('only the existing mobile 1920/200 Cancel contract is observed', () => {
  assert.equal(selectedMaterialObservation('webkit-mobile', options), true);
  for (const [project, change] of [['chromium', {}], ['webkit-desktop', {}],
    ['webkit-mobile', { percent: 100 }], ['webkit-mobile', { contract: 'save-reload' }],
    ['webkit-mobile', { viewport: { width: 1440, height: 900 } }]])
    assert.equal(selectedMaterialObservation(project, { ...options, ...change }), false);
});
test('success is returned after exactly one unchanged action', async () => {
  let calls = 0; const errors = [];
  const result = await runObservedAction(work => work(), async () => { calls++; return 42; }, errors);
  assert.equal(result, 42); assert.equal(calls, 1); assert.deepEqual(errors, []);
});
test('registration failure still runs original action exactly once and invalidates telemetry', async () => {
  let calls = 0; const errors = [];
  const result = await runObservedAction(async () => { throw new Error('registration'); },
    async () => { calls++; return 'original'; }, errors);
  assert.equal(calls, 1); assert.equal(result, 'original'); assert.match(errors[0], /registration/);
});
test('cleanup failure never replays a successful UI action', async () => {
  let calls = 0; const errors = [];
  const result = await runObservedAction(async work => { await work(); throw new Error('cleanup'); },
    async () => { calls++; return 'saved'; }, errors);
  assert.equal(calls, 1); assert.equal(result, 'saved'); assert.match(errors[0], /cleanup/);
});
test('original action failure wins over observer cleanup failure', async () => {
  const original = new Error('original expectation failure'); let calls = 0;
  await assert.rejects(runObservedAction(async work => { try { await work(); } finally { throw new Error('cleanup'); } },
    async () => { calls++; throw original; }, []), value => value === original);
  assert.equal(calls, 1);
});
test('a falsy thrown action error is preserved', async () => {
  let rejected = false;
  try { await runObservedAction(work => work(), async () => { throw null; }, []); }
  catch (error) { rejected = true; assert.equal(error, null); }
  assert.equal(rejected, true);
});
test('an erroneous observer cannot execute the action twice', async () => {
  let calls = 0; const errors = [];
  await runObservedAction(async work => { await work(); await work(); }, async () => { calls++; }, errors);
  assert.equal(calls, 1); assert.match(errors[0], /replay/);
});
test('partial telemetry is attached before identity failure and cannot claim completion', async () => {
  const sequence = [], attachments = [];
  const info = { project: { name: 'webkit-mobile', use: {} }, titlePath: ['target'], retry: 1,
    timeout: 30000, errors: [{ message: 'original timeout' }],
    attach: async (name, data) => { sequence.push(name); attachments.push(JSON.parse(data.body)); } };
  await prepareMaterialObservation({ exposeBinding: async () => { throw new Error('closed'); } }, info, options);
  assert.equal(hasMaterialObservation(info, 'material-cancel-1920x1080-200'), true);
  assert.equal(hasMaterialObservation(info, 'material-save-1920x1080-200'), false);
  await attachMaterialObservation(info, async () => { sequence.push('identity'); throw new Error('denied'); });
  assert.deepEqual(sequence, ['material-current-pr-resource-observation', 'identity', 'material-current-pr-process-identity-missing']);
  assert.equal(attachments[0].diagnosticComplete, false);
  assert.deepEqual(attachments[0].recordedTestErrors, ['original timeout']);
  assert.match(attachments[0].diagnosticErrors[0], /closed/);
  assert.equal(hasMaterialObservation(info, 'material-cancel-1920x1080-200'), false);
});
test('failed binding cannot cause a page callback error or skip the UI action', async () => {
  const info = { project: { name: 'webkit-mobile', use: {} }, titlePath: ['target'], retry: 0,
    timeout: 30000, errors: [], attach: async () => {} };
  await prepareMaterialObservation({ exposeBinding: async () => { throw new Error('denied'); } }, info, options);
  let calls = 0;
  const result = await observeMaterialControl({ page: () => { throw new Error('must not observe'); } }, info,
    'material-cancel-1920x1080-200', async () => { calls++; return 7; });
  assert.equal(calls, 1); assert.equal(result, 7);
  await attachMaterialObservation(info, async () => ({}));
});
test('inactive contracts neither register nor attach observations', async () => {
  let calls = 0; const info = { project: { name: 'chromium' }, attach: () => { calls++; } };
  await prepareMaterialObservation({ exposeBinding: () => { calls++; } }, info, options);
  await attachMaterialObservation(info, () => { calls++; });
  assert.equal(calls, 0);
});
test('original normal control checks remain in their order after the observation guard', async () => {
  const source = await fs.readFile(new URL('../bookshelf-surface.spec.mjs', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('async function reachMaterialControl'), source.indexOf('for (const viewport of [{ width: 1440'));
  assert.ok(body.includes('() => reachMaterialControl(control, testInfo, name, true)'));
  const operations = ['await control.focus()', 'await control.click({ trial: true })', 'const metrics = await control.evaluate',
    'if (actionError) throw actionError', 'expect(metrics.blockers).toEqual([])', 'await expect(control).toBeFocused()'];
  let previous = -1;
  for (const operation of operations) { const index = body.indexOf(operation); assert.ok(index > previous, operation); previous = index; }
});
