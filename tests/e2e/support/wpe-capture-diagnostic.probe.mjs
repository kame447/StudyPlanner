import assert from 'node:assert/strict';
import test from 'node:test';
import base from '../playwright.cross-browser.config.mjs';
import { buildCaptureDiagnostic, captureSlots, captureTreatment, captureCase } from './wpe-capture-diagnostic.mjs';

const options = slot => ({ slot, artifactsDir: '/diagnostic-artifacts' });
test('only four explicit counterbalanced slots are admitted', () => {
  assert.deepEqual(captureSlots, ['capture-on-1', 'capture-off-2', 'capture-off-3', 'capture-on-4']);
  for (const slot of [undefined, '', 'on', '../capture-on-1', 'capture-on-5'])
    assert.throws(() => captureTreatment(slot), /explicit bounded capture slot/);
});
test('capture treatment changes exactly video demand and trace screenshot demand', () => {
  const on = captureTreatment('capture-on-1'), off = captureTreatment('capture-off-2');
  assert.equal(on.video, 'retain-on-failure'); assert.equal(off.video, 'off');
  assert.equal(on.trace.screenshots, true); assert.equal(off.trace.screenshots, false);
  assert.deepEqual({ ...on.trace, screenshots: false }, off.trace);
  assert.equal(off.trace.mode, 'on');
  assert.equal(off.trace.snapshots, true); assert.equal(off.trace.sources, true);
});
test('ordinary configurations are not mutated', () => {
  const before = structuredClone(base);
  // structuredClone omits the symbol used by Playwright defineConfig. Include
  // its original descriptor so the mutation check covers it as well.
  for (const key of Object.getOwnPropertySymbols(base))
    Object.defineProperty(before, key, Object.getOwnPropertyDescriptor(base, key));
  for (const slot of captureSlots) buildCaptureDiagnostic(base, options(slot));
  assert.deepEqual(base, before);
});
test('project identity, browser, DPR and all other use options are preserved', () => {
  const mobile = base.projects.find(p => p.name === 'webkit-mobile');
  for (const slot of captureSlots) {
    const result = buildCaptureDiagnostic(base, options(slot));
    const { trace, video, ...rest } = result.projects[0].use;
    assert.deepEqual(rest, mobile.use);
    assert.equal(result.projects[0].name, mobile.name);
    assert.deepEqual(result.use, base.use);
    assert.equal(result.use.screenshot, 'only-on-failure');
  }
});
test('test deadline, retries, failure policy, worker and web servers are preserved', () => {
  const result = buildCaptureDiagnostic(base, options('capture-off-2'));
  for (const key of ['timeout', 'expect', 'retries', 'failOnFlakyTests', 'forbidOnly', 'workers', 'fullyParallel', 'webServer'])
    assert.deepEqual(result[key], base[key], key);
});
test('only the existing full Cancel200 contract is selected', () => {
  const result = buildCaptureDiagnostic(base, options('capture-on-1'));
  assert.deepEqual(result.projects[0].testMatch, ['**/bookshelf-surface.spec.mjs']);
  assert.ok(captureCase.test('webkit-mobile bookshelf-surface.spec.mjs material long text 1920x1080 keeps full detail text and cancels unsaved chapter edits at 200%'));
  assert.ok(!captureCase.test('material long text 1280x900 keeps full detail text and cancels unsaved chapter edits at 200%'));
  assert.ok(!captureCase.test('material long text 1920x1080 keeps full detail text and cancels unsaved chapter edits at 100%'));
  assert.ok(!captureCase.test('material long text 1920x1080 saves the last chapter and preserves it after full reload at 200%'));
});
test('every arm has distinct artifacts and an explicit non-acceptance label', () => {
  const configs = captureSlots.map(slot => buildCaptureDiagnostic(base, options(slot)));
  assert.equal(new Set(configs.map(c => c.outputDir)).size, 4);
  assert.equal(new Set(configs.map(c => c.reporter[1][1].outputFile)).size, 4);
  for (const config of configs) assert.equal(config.metadata.wpeCaptureDiagnostic.acceptanceReplacement, false);
});
test('changed baseline policies require review rather than silent adaptation', () => {
  for (const change of [{ retries: 0 }, { workers: 2 }, { failOnFlakyTests: false }, { forbidOnly: false }])
    assert.throws(() => buildCaptureDiagnostic({ ...base, ...change }, options('capture-on-1')));
  for (const change of [{ trace: 'off' }, { video: 'off' }])
    assert.throws(() => buildCaptureDiagnostic({ ...base, use: { ...base.use, ...change } }, options('capture-on-1')));
});
