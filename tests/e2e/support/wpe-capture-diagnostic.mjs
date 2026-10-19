import assert from 'node:assert/strict';
import path from 'node:path';

// A separate diagnostic entry point. Ordinary regression configuration never
// imports this file and the existing acceptance spec/helpers stay unchanged.
export const captureSlots = Object.freeze([
  'capture-on-1', 'capture-off-2', 'capture-off-3', 'capture-on-4',
]);
export const captureCase = /material long text 1920x1080 keeps full detail text and cancels unsaved chapter edits at 200%$/;

export function captureTreatment(slot) {
  assert.ok(captureSlots.includes(slot), 'Choose one explicit bounded capture slot');
  const enabled = slot.startsWith('capture-on-');
  return {
    video: enabled ? 'retain-on-failure' : 'off',
    // Both consumers share the browser screencast. Disabling video alone does
    // not remove capture while tracing still requests continuous screenshots.
    // Retain action/DOM traces in BOTH arms, including passes, so the absence
    // of continuous frames can be audited rather than inferred from deletion.
    trace: { mode: 'on', screenshots: enabled, snapshots: true, sources: true },
  };
}

export function buildCaptureDiagnostic(base, { slot, artifactsDir }) {
  assert.equal(base.retries, 1, 'Use CI=1 to preserve the ordinary CI retry policy');
  assert.equal(base.workers, 1, 'The comparison requires the ordinary single CI worker');
  assert.equal(base.forbidOnly, true);
  assert.equal(base.failOnFlakyTests, true);
  assert.equal(base.use.trace, 'retain-on-failure', 'Re-review changed baseline tracing');
  assert.equal(base.use.video, 'retain-on-failure', 'Re-review changed baseline video');
  const mobile = base.projects.find(project => project.name === 'webkit-mobile');
  assert.ok(mobile, 'Original WebKit mobile project is required');
  assert.equal(mobile.use.deviceScaleFactor, 3);
  assert.equal(mobile.use.browserName, 'webkit');
  assert.ok(!mobile.use.trace && !mobile.use.video, 'Re-review project recording overrides');
  const treatment = captureTreatment(slot);
  const output = path.join(artifactsDir, 'wpe-capture-diagnostic', slot);
  return {
    ...base,
    grep: captureCase,
    outputDir: path.join(output, 'results'),
    reporter: [
      ['list'],
      ['json', { outputFile: path.join(output, 'results.json') }],
      ['html', { outputFolder: path.join(output, 'report'), open: 'never' }],
    ],
    metadata: { ...base.metadata, wpeCaptureDiagnostic: {
      schema: 1, slot, factor: 'continuous-browser-capture', acceptanceReplacement: false,
      limitation: 'One counterbalanced block is diagnostic evidence, not a speedup or reliability proof.',
    } },
    projects: [{
      ...mobile,
      // Keep the exact name: the existing bounded native observer selects it.
      testMatch: ['**/bookshelf-surface.spec.mjs'],
      use: { ...mobile.use, ...treatment },
    }],
  };
}
