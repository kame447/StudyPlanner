import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { observeWindow, finishProcessIdentity, readAdmission } from './material-wpe-observation.mjs';
import { runObservedAction } from './material-pr-observation.mjs';

// Two existing clicks in one existing case. No new UI action or deadline.
const observations = new WeakMap();
export const monthObservationWindows = ['month-day-sheet-edit', 'month-edit-end-picker'];
export function selectedMonthObservation(project, { viewport, contract }) {
  return project === 'webkit-mobile' && viewport.width === 1280 && viewport.height === 900
    && contract === 'overnight-create-edit-reload';
}
export async function prepareMonthObservation(page, testInfo, options) {
  if (!selectedMonthObservation(testInfo.project.name, options)) return;
  const evidence = { schema: 1, purpose: 'Issue776 bounded observation of existing overnight acceptance',
    case: { project: testInfo.project.name, titlePath: testInfo.titlePath, retry: testInfo.retry,
      timeout: testInfo.timeout, ...options },
    configuredUse: { deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
      trace: testInfo.project.use.trace, video: testInfo.project.use.video },
    windows: [], boundaries: [], admissions: [], diagnosticErrors: [], setupNodeStartMs: performance.now(),
    interpretation: 'Observation adds binding, layout reads, native callbacks and process-counter sampling; it can change frame scheduling and elapsed time. Two native frames and three timers per window are sparse samples, not FPS or proof of responsiveness throughout the window. Rect equality cannot exclude intervening layout or paint. Cgroup CPU includes other processes, process CPU remains kernel ticks, and missing samples are unknown. Keep Node, native browser and installed page clocks separate. These windows surround ordinary clicks, not Playwright internal stable-check boundaries; correlate with the retained trace. Neither a pass nor a failure here proves a production performance fix.' };
  observations.set(testInfo, evidence);
  try {
    await page.exposeBinding('__wpeDiagnosticEmit', (_source, event) => {
      const window = evidence.windows.find(value => value.name === event.name);
      if (!window || window.browserEvents.length >= 8) {
        evidence.diagnosticErrors.push('Unexpected or excessive telemetry'); return;
      }
      window.browserEvents.push(event);
    });
    evidence.bindingReady = true;
  } catch (error) { evidence.diagnosticErrors.push(`binding: ${String(error)}`); }
  evidence.setupNodeEndMs = performance.now();
}
export function validateMonthAdmission(value) {
  assert.equal(value.appearance, 'standard'); assert.equal(value.theme, 'light');
  assert.equal(value.width, 1280); assert.equal(value.height, 900); assert.equal(value.dpr, 3);
  assert.equal(value.coarse, true); assert.equal(value.reduced, true);
  assert.equal(value.visible, 'visible'); assert.equal(value.focused, true); assert.equal(value.connected, true);
}
export async function observeMonthControl(control, testInfo, name, work, observe = observeWindow) {
  const evidence = observations.get(testInfo);
  if (!evidence) return work();
  if (!monthObservationWindows.includes(name) || evidence.boundaries.some(value => value.name === name)) {
    evidence.diagnosticErrors.push(`Unexpected or repeated window: ${name}`); return work();
  }
  const boundary = { name, nodeStartMs: performance.now() }; evidence.boundaries.push(boundary);
  if (!evidence.bindingReady) return work();
  try {
    const admission = await control.evaluate(readAdmission);
    evidence.admissions.push({ name, ...admission }); validateMonthAdmission(admission);
  } catch (error) { evidence.diagnosticErrors.push(`admission ${name}: ${String(error)}`); }
  boundary.admissionNodeEndMs = performance.now();
  // Record registration overhead separately without changing the shared observer.
  const locator = { evaluate: async (...args) => {
    boundary.registrationNodeStartMs = performance.now();
    try { return await control.evaluate(...args); }
    finally { boundary.registrationNodeEndMs = performance.now(); }
  } };
  try {
    return await runObservedAction(observedWork => observe({ page: control.page(), locator, name,
      windows: evidence.windows, work: observedWork }), work, evidence.diagnosticErrors);
  } finally { boundary.nodeEndMs = performance.now(); }
}
export async function attachMonthObservation(testInfo, identify = finishProcessIdentity) {
  const evidence = observations.get(testInfo);
  if (!evidence) return;
  observations.delete(testInfo);
  evidence.recordedTestErrors = testInfo.errors.map(error => error.message ?? String(error));
  evidence.diagnosticComplete = evidence.diagnosticErrors.length === 0 && evidence.windows.length === 2
    && monthObservationWindows.every(name => evidence.windows.some(window => window.name === name))
    && evidence.windows.every(window => window.actionCompleted && !window.cleanupError
      && window.browserFinal?.frames.length === 2 && window.browserFinal?.timers.length === 3
      && window.browserFinal.emitErrors.length === 0);
  // Preserve partial values first, including when the unchanged test deadline
  // interrupts an action or the final screenshot. Identity is separate evidence.
  await testInfo.attach('month-overnight-resource-observation', {
    body: JSON.stringify(evidence), contentType: 'application/json' });
  try {
    await testInfo.attach('month-overnight-process-identity', {
      body: JSON.stringify(await identify(evidence.windows)), contentType: 'application/json' });
  } catch (error) {
    await testInfo.attach('month-overnight-process-identity-missing', {
      body: JSON.stringify({ missing: String(error) }), contentType: 'application/json' });
  }
}
