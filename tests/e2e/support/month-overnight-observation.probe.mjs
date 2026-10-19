import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { selectedMonthObservation, prepareMonthObservation, validateMonthAdmission,
  observeMonthControl, attachMonthObservation, monthObservationWindows } from './month-overnight-observation.mjs';

const options = { viewport: { width: 1280, height: 900 }, contract: 'overnight-create-edit-reload' };
const admission = { appearance: 'standard', theme: 'light', width: 1280, height: 900, dpr: 3,
  coarse: true, reduced: true, visible: 'visible', focused: true, connected: true };
function fixture(project = 'webkit-mobile') {
  const attachments = [], sequence = [];
  const info = { project: { name: project, use: { deviceScaleFactor: 3 } }, titlePath: ['overnight target'],
    retry: 0, timeout: 30000, errors: [], attach: async (name, data) => {
      sequence.push(name); attachments.push({ name, value: JSON.parse(data.body) });
    } };
  const page = { exposeBinding: async (_name, callback) => { page.emit = callback; } };
  return { info, page, attachments, sequence };
}
function control(page, state = admission) { return { page: () => page, evaluate: async () => state }; }
function completeObserver({ name, windows, work }) {
  const window = { name, browserEvents: [], samples: [],
    browserFinal: { frames: [{}, {}], timers: [{}, {}, {}], emitErrors: [] } };
  windows.push(window);
  return work().then(result => { window.actionCompleted = true; return result; });
}
async function resource(f) {
  await attachMonthObservation(f.info, async () => ({}));
  return f.attachments.find(a => a.name === 'month-overnight-resource-observation')?.value;
}

test('selection is only the existing WebKit mobile 1280x900 overnight case', () => {
  assert.equal(selectedMonthObservation('webkit-mobile', options), true);
  for (const [project, change] of [['chromium', {}], ['webkit-desktop', {}],
    ['webkit-mobile', { viewport: { width: 390, height: 900 } }],
    ['webkit-mobile', { viewport: { width: 1280, height: 1080 } }],
    ['webkit-mobile', { contract: 'other-month-case' }]])
    assert.equal(selectedMonthObservation(project, { ...options, ...change }), false);
});
test('unselected cases do no observation or attachment and execute their action once', async () => {
  const f = fixture('chromium'); let calls = 0;
  f.page.exposeBinding = () => { throw new Error('must not register'); };
  await prepareMonthObservation(f.page, f.info, options);
  assert.equal(await observeMonthControl(null, f.info, monthObservationWindows[0], async () => ++calls), 1);
  await attachMonthObservation(f.info, () => { throw new Error('must not identify'); });
  assert.equal(calls, 1); assert.deepEqual(f.attachments, []);
});
test('month admission checks this runtime without material-only paint assumptions', () => {
  validateMonthAdmission(admission);
  for (const patch of [{ appearance: 'pixel' }, { theme: 'dark' }, { dpr: 1 }, { width: 390 },
    { height: 1080 }, { coarse: false }, { reduced: false }, { focused: false }, { connected: false }, { visible: 'hidden' }])
    assert.throws(() => validateMonthAdmission({ ...admission, ...patch }));
});
test('both distinct windows preserve ordinary successful actions exactly once', async () => {
  const f = fixture(); let calls = 0;
  await prepareMonthObservation(f.page, f.info, options);
  for (const name of monthObservationWindows)
    assert.equal(await observeMonthControl(control(f.page), f.info, name, async () => ++calls, completeObserver), calls);
  const evidence = await resource(f);
  assert.equal(calls, 2); assert.equal(evidence.diagnosticComplete, true);
  assert.deepEqual(evidence.windows.map(w => w.name), monthObservationWindows);
  assert.equal(evidence.case.timeout, 30000);
});
test('registration boundary forwards the exact browser callback and argument', async () => {
  const f = fixture(); await prepareMonthObservation(f.page, f.info, options);
  const fn = () => {}, arg = { name: monthObservationWindows[0] }, received = [];
  const target = { page: () => f.page, evaluate: async (...args) => { received.push(args); return admission; } };
  await observeMonthControl(target, f.info, arg.name, async () => 3, async ({ locator, work }) => {
    await locator.evaluate(fn, arg); return work();
  });
  assert.deepEqual(received[1], [fn, arg]);
  const [b] = (await resource(f)).boundaries;
  assert.ok(b.nodeStartMs <= b.admissionNodeEndMs && b.admissionNodeEndMs <= b.registrationNodeStartMs);
  assert.ok(b.registrationNodeStartMs <= b.registrationNodeEndMs && b.registrationNodeEndMs <= b.nodeEndMs);
});
test('binding failure cannot execute callbacks or omit/replay the action', async () => {
  const f = fixture(); f.page.exposeBinding = async () => { throw new Error('closed'); };
  await prepareMonthObservation(f.page, f.info, options); let calls = 0;
  await observeMonthControl(null, f.info, monthObservationWindows[0], async () => ++calls, () => { throw new Error('must not observe'); });
  const evidence = await resource(f);
  assert.equal(calls, 1); assert.equal(evidence.diagnosticComplete, false); assert.match(evidence.diagnosticErrors[0], /closed/);
});
test('registration failure falls back once and partial evidence precedes identity failure', async () => {
  const f = fixture(); await prepareMonthObservation(f.page, f.info, options); let calls = 0;
  f.info.errors = [{ message: 'original timeout' }];
  await observeMonthControl(control(f.page), f.info, monthObservationWindows[0], async () => ++calls,
    async () => { throw new Error('registration'); });
  await attachMonthObservation(f.info, async () => { f.sequence.push('identity'); throw new Error('missing'); });
  assert.equal(calls, 1);
  assert.deepEqual(f.sequence, ['month-overnight-resource-observation', 'identity', 'month-overnight-process-identity-missing']);
  assert.equal(f.attachments[0].value.diagnosticComplete, false);
  assert.deepEqual(f.attachments[0].value.recordedTestErrors, ['original timeout']);
});
test('action failure, including a falsy error, wins over observer cleanup failure', async () => {
  for (const original of [new Error('UI contract failed'), null]) {
    const f = fixture(); await prepareMonthObservation(f.page, f.info, options); let calls = 0, caught = false;
    try {
      await observeMonthControl(control(f.page), f.info, monthObservationWindows[0], async () => { calls++; throw original; },
        async ({ work }) => { try { await work(); } finally { throw new Error('cleanup'); } });
    } catch (error) { caught = true; assert.equal(error, original); }
    assert.equal(caught, true); assert.equal(calls, 1); await resource(f);
  }
});
test('cleanup failure does not replay a successful action', async () => {
  const f = fixture(); await prepareMonthObservation(f.page, f.info, options); let calls = 0;
  const value = await observeMonthControl(control(f.page), f.info, monthObservationWindows[0], async () => { calls++; return 42; },
    async ({ work }) => { await work(); throw new Error('cleanup'); });
  assert.equal(value, 42); assert.equal(calls, 1);
  assert.match((await resource(f)).diagnosticErrors[0], /cleanup/);
});
test('invalid admission or repeated window invalidates diagnostics without changing UI work', async () => {
  const f = fixture(); await prepareMonthObservation(f.page, f.info, options); let calls = 0, observers = 0;
  const observer = async args => { observers++; return completeObserver(args); };
  for (let i = 0; i < 2; i++) await observeMonthControl(control(f.page, { ...admission, dpr: 1 }), f.info,
    monthObservationWindows[0], async () => ++calls, observer);
  const evidence = await resource(f);
  assert.equal(calls, 2); assert.equal(observers, 1); assert.equal(evidence.diagnosticComplete, false);
  assert.ok(evidence.diagnosticErrors.some(e => e.startsWith('admission')));
  assert.ok(evidence.diagnosticErrors.some(e => e.startsWith('Unexpected or repeated')));
});
test('partial delivered events survive without claiming complete frames or zero delay', async () => {
  const f = fixture(); await prepareMonthObservation(f.page, f.info, options);
  await observeMonthControl(control(f.page), f.info, monthObservationWindows[0], async () => undefined, async ({ windows, name, work }) => {
    windows.push({ name, browserEvents: [], samples: [] });
    f.page.emit(null, { name, kind: 'frame', index: 1, nativeMs: 1700 });
    return work();
  });
  const evidence = await resource(f);
  assert.equal(evidence.windows[0].browserEvents.length, 1); assert.equal(evidence.diagnosticComplete, false);
  assert.match(evidence.interpretation, /missing samples are unknown/);
});
test('only two original click sites are wrapped and persistence/screenshot order remains', async () => {
  const source = await fs.readFile(new URL('../month-event-range.spec.mjs', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('test.describe(`overnight month-event persistence'));
  assert.equal((body.match(/observeMonthControl\(/g) ?? []).length, 2);
  assert.equal((body.match(/await page.reload\(\)/g) ?? []).length, 2);
  const ordered = ["await chooseTime(0, '18')", "await chooseTime(1, '09')", 'const [created] = await read()',
    'await expect(read()).resolves.toEqual([created])', "'month-day-sheet-edit', () => daySheetEvent.click()",
    "await chooseTime(1, '18', true)", "await expect.poll(read).toEqual([{ ...created, endTime: '18:00' }])",
    'await page.reload()', "await expect.poll(read).toEqual([{ ...created, endTime: '18:00' }])", '.toHaveCount(1)',
    "await page.screenshot({ path: testInfo.outputPath(`month-event-overnight-${width}.png`), animations: 'disabled' })"];
  let position = 0;
  for (const text of ordered) { const next = body.indexOf(text, position); assert.ok(next >= position, text); position = next + text.length; }
  assert.ok(body.includes("'month-edit-end-picker', () => input.click()"));
  assert.ok(body.includes('await expect(minute).toHaveClass(/\\bactive\\b/)'));
  assert.ok(body.includes('toHaveText(`${hour}:00`)'));
  assert.doesNotMatch(body, /setTimeout|force:\s*true|trial:\s*true|test\.skip/);
});
