import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { registerNativeObservation, stopNativeObservation, observeWindow, parseProcessStat, startSampling, validateAdmission } from './material-wpe-observation.mjs';
function browser() {
  let now = 10, id = 0;
  const frames = new Map(), timers = new Map(), events = [], cancelled = [];
  const NativeDate = class { static now() { return 100000 + now; } };
  const PageDate = class { static isFake = true; static now() { return 1000; } };
  const context = vm.createContext({
    Date: PageDate, performance: { now: () => 5 }, document: { visibilityState: 'visible', hasFocus: () => true },
    requestAnimationFrame() {}, cancelAnimationFrame() {}, setTimeout() {}, clearTimeout() {},
    __pwClock: { builtins: { Date: NativeDate, performance: { now: () => now },
      requestAnimationFrame(fn) { frames.set(++id, fn); return id; },
      cancelAnimationFrame(i) { cancelled.push(i); frames.delete(i); },
      setTimeout(fn, ms) { assert.equal(ms, 100); timers.set(++id, fn); return id; },
      clearTimeout(i) { cancelled.push(i); timers.delete(i); } } },
    __wpeDiagnosticEmit: async value => { events.push(value); },
    element: { isConnected: true, getBoundingClientRect: () => ({ x: 0, y: 1, width: 80, height: 44 }) },
  });
  const run = (fn, arg) => { context.arg = arg; return vm.runInContext(`(${fn.toString()})(element, arg)`, context); };
  const stop = () => vm.runInContext(`(${stopNativeObservation.toString()})('window')`, context);
  return { context, run, stop, events, frames, timers, cancelled, fire(map) { const [i, fn] = map.entries().next().value; map.delete(i); now += 100; fn(now); } };
}
test('actual browser callbacks bound two native frames and three timers, preserve separate origins', () => {
  const b = browser(); b.run(registerNativeObservation, { name: 'window' });
  while (b.frames.size) b.fire(b.frames); while (b.timers.size) b.fire(b.timers);
  const value = b.stop(); assert.equal(value.frames.length, 2); assert.equal(value.timers.length, 3);
  assert.equal(value.registeredNativeMs, 10); assert.equal(value.registeredPageMs, 5);
  assert.equal(b.events.length, 5); assert.equal(value.final.connected, true);
  assert.equal(b.context.__wpeActiveObservation, undefined);
});
test('partial observation cancels pending native callbacks and preserves detach state', () => {
  const b = browser(); b.run(registerNativeObservation, { name: 'window' }); b.fire(b.timers);
  b.context.element.isConnected = false; const value = b.stop();
  assert.equal(value.frames.length, 0); assert.equal(value.timers.length, 1);
  assert.equal(value.final.connected, false); assert.equal(b.frames.size + b.timers.size, 0);
});
test('API alias, hidden page and overlapping observer fail closed', () => {
  const b = browser(); b.context.__pwClock.builtins.requestAnimationFrame = b.context.requestAnimationFrame;
  assert.throws(() => b.run(registerNativeObservation, { name: 'window' }), /admission/);
  const c = browser(); c.context.document.visibilityState = 'hidden';
  assert.throws(() => c.run(registerNativeObservation, { name: 'window' }), /Invisible/);
  const d = browser(); d.run(registerNativeObservation, { name: 'window' });
  assert.throws(() => d.run(registerNativeObservation, { name: 'window' }), /Overlapping/); d.stop();
});
test('process stat parser handles spaces/parentheses and rejects malformed counters', () => {
  const fields = ['S',...Array.from({ length: 23 }, (_, i) => String(i + 1))];
  const p = parseProcessStat(`123 (WebKit (test)) ${fields.join(' ')}`);
  assert.equal(p.pid, 123); assert.equal(p.name, 'WebKit (test)'); assert.equal(p.userTicks, 11); assert.equal(p.startTicks, 19);
  assert.throws(() => parseProcessStat('bad'), /Malformed/);
});
test('sampler never overlaps reads and stop prevents further sampling', async () => {
  const records = []; let reads = 0, active = 0, maximum = 0;
  const stop = startSampling(records, async () => { reads++; active++; maximum = Math.max(maximum, active);
    await new Promise(r => setTimeout(r, 15)); active--; return { counters: { missing: true } }; }, 1);
  await new Promise(r => setTimeout(r, 24)); await stop(); const count = reads;
  await new Promise(r => setTimeout(r, 5)); assert.equal(reads, count); assert.equal(maximum, 1); assert.ok(records.length > 0);
});
test('sampler records denied read as missing without substituting zero', async () => {
  const records = [], stop = startSampling(records, async () => { throw new Error('EACCES'); }); await stop();
  assert.match(records[0].missing, /EACCES/); assert.equal(records[0].counters, undefined);
});
test('actual observe wrapper retains original action error if cleanup also fails', async () => {
  const error = new Error('original action failure'), windows = [];
  await assert.rejects(observeWindow({ page: { evaluate: async () => { throw new Error('closed page'); } },
    locator: { evaluate: async () => ({}) }, name: 'x', windows, work: async () => { throw error; } }), value => value === error);
  assert.match(windows[0].cleanupError, /closed page/); assert.equal(windows[0].actionCompleted, undefined);
});
test('original filter and viewport admission rejects treatment, DPR or invisibility', () => {
  const v = { appearance: 'pixel', theme: 'light', dpr: 3, width: 1920, height: 1080, visible: 'visible',
    focused: true, connected: true, coarse: true, reduced: true, position: 'fixed', zIndex: '95', opacity: '1', backgroundColor: 'color(srgb 1 1 1)', filter: 'blur(12px)', webkitFilter: '' };
  validateAdmission(v); validateAdmission({ ...v, backgroundColor: 'rgb(255, 255, 255)' });
  for (const delta of [{ filter: 'none' }, { dpr: 1 }, { visible: 'hidden' }, { backgroundColor: 'rgba(255, 255, 255, 0.68)' }, { backgroundColor: 'color(display-p3 1 1 1)' }, { backgroundColor: 'color(srgb 1.1 1 1)' }]) assert.throws(() => validateAdmission({ ...v, ...delta }));
});
test('denied discovery and cgroup counters stay explicit instead of an empty success', async () => {
  const fs = (await import('node:fs/promises')).default;
  const { readCounters } = await import('./material-wpe-observation.mjs');
  const original = fs.readFile;
  fs.readFile = async path => {
    if (path === '/proc/self/cgroup') return '0::/diagnostic-group\n';
    const error = new Error('denied'); error.code = 'EACCES'; throw error;
  };
  try {
    const value = await readCounters(); assert.deepEqual(value.processes, []);
    assert.ok(value.discoveryMissing.some(v => v.counter === 'main-thread-children' && v.reason === 'EACCES'));
    assert.equal(value.counters['/sys/fs/cgroup/diagnostic-group/cpu.stat'].missing, 'EACCES');
  } finally { fs.readFile = original; }
});
