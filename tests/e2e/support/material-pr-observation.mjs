import { performance } from 'node:perf_hooks';
import { observeWindow, finishProcessIdentity, readAdmission, validateAdmission } from './material-wpe-observation.mjs';

// Observation of one existing acceptance case, not a replacement acceptance.
// No extra navigation/action, changed browser option or extended test deadline.
const observations = new WeakMap();
const cancelWindow = 'material-cancel-1920x1080-200';
export function selectedMaterialObservation(project, { viewport, percent, contract }) {
  return project === 'webkit-mobile' && viewport.width === 1920 && viewport.height === 1080
    && percent === 200 && contract === 'detail-cancel';
}
export async function prepareMaterialObservation(page, testInfo, options) {
  if (!selectedMaterialObservation(testInfo.project.name, options)) return;
  const evidence = { schema: 1, purpose: 'Current PR741 single-seed acceptance with bounded observation',
    case: { project: testInfo.project.name, titlePath: testInfo.titlePath, retry: testInfo.retry,
      timeout: testInfo.timeout, ...options },
    configuredUse: { deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
      trace: testInfo.project.use.trace, video: testInfo.project.use.video },
    windows: [], admissions: [], diagnosticErrors: [], setupNodeStartMs: performance.now(),
    interpretation: 'Instrumentation changes observation cost. Two native frames and three timers are bounded samples, not FPS. Missing/partial samples are unknown, never zero delay. Separate clock origins must not be subtracted. A passed measurement cannot replace the original UI assertions. This is not the unexecuted original-seed WPE diagnostic.' };
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
export function hasMaterialObservation(testInfo, name) {
  return observations.has(testInfo) && name === cancelWindow;
}

// An observer failure must neither omit/replay the real UI action nor replace
// its error. Admission failures invalidate telemetry, not the UI contract.
export async function runObservedAction(observe, work, diagnosticErrors) {
  let started = false, actionFailed = false, actionError, result;
  try {
    await observe(async () => {
      if (started) throw new Error('Observer attempted to replay the action');
      started = true;
      try { result = await work(); return result; }
      catch (error) { actionFailed = true; actionError = error; throw error; }
    });
  } catch (error) { diagnosticErrors.push(String(error)); }
  if (!started) return work();
  if (actionFailed) throw actionError;
  return result;
}
export async function observeMaterialControl(control, testInfo, name, work) {
  const evidence = observations.get(testInfo);
  if (!evidence.bindingReady) return work();
  const page = control.page();
  try {
    const paint = await page.locator('.home-bottom-nav').evaluate(readAdmission);
    evidence.admissions.push(paint); validateAdmission(paint);
  } catch (error) { evidence.diagnosticErrors.push(`paint admission: ${String(error)}`); }
  return runObservedAction(observedWork => observeWindow({ page, locator: control, name,
    windows: evidence.windows, work: observedWork }), work, evidence.diagnosticErrors);
}
export async function attachMaterialObservation(testInfo, identify = finishProcessIdentity) {
  const evidence = observations.get(testInfo);
  if (!evidence) return;
  observations.delete(testInfo);
  evidence.recordedTestErrors = testInfo.errors.map(error => error.message ?? String(error));
  evidence.diagnosticComplete = evidence.diagnosticErrors.length === 0 && evidence.windows.length === 1
    && evidence.windows.every(window => window.actionCompleted && !window.cleanupError
      && window.browserFinal?.frames.length === 2 && window.browserFinal?.timers.length === 3
      && window.browserFinal.emitErrors.length === 0);
  // Persist partial measurements before any executable hashing. A timeout can
  // close the page; already-delivered native events still survive in this JSON.
  await testInfo.attach('material-current-pr-resource-observation', {
    body: JSON.stringify(evidence), contentType: 'application/json' });
  try {
    const identity = await identify(evidence.windows);
    await testInfo.attach('material-current-pr-process-identity', {
      body: JSON.stringify(identity), contentType: 'application/json' });
  } catch (error) {
    await testInfo.attach('material-current-pr-process-identity-missing', {
      body: JSON.stringify({ missing: String(error) }), contentType: 'application/json' });
  }
}
