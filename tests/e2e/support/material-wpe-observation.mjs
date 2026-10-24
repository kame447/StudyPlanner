import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// No environment/command-line/network capture. Only fixed counter files and
// descendants of this worker are observed. Missing counters stay explicit.
const COUNTERS = ['/proc/stat', '/proc/pressure/cpu', '/proc/pressure/memory',
  '/proc/self/cgroup'];
const PROCESS_NAMES = /^(MiniBrowser|WebKit.*|WPE.*|ffmpeg|minibrowser.*)$/i;
async function optionalRead(path) {
  try { const value = await fs.readFile(path, 'utf8');
    if (value.length > 1_048_576) return { missing: 'counter exceeded 1 MiB bound' };
    return { value }; }
  catch (error) { return { missing: error.code ?? String(error) }; }
}
export function parseProcessStat(text) {
  const end = text.lastIndexOf(')'); const start = text.indexOf('(');
  assert.ok(start > 0 && end > start, 'Malformed process stat');
  const fields = text.slice(end + 2).trim().split(/\s+/);
  const result = { pid: Number(text.slice(0, start).trim()), name: text.slice(start + 1, end),
    state: fields[0], ppid: Number(fields[1]), userTicks: Number(fields[11]),
    systemTicks: Number(fields[12]), startTicks: Number(fields[19]),
    virtualBytes: Number(fields[20]), rssPages: Number(fields[21]) };
  for (const key of ['pid', 'ppid', 'userTicks', 'systemTicks', 'startTicks', 'virtualBytes', 'rssPages'])
    assert.ok(Number.isFinite(result[key]), `Invalid stat ${key}`);
  return result;
}
async function descendants(root) {
  const queue = [root], seen = new Set(), result = [], missing = [];
  while (queue.length && seen.size < 128) {
    const pid = queue.shift(); if (seen.has(pid)) continue; seen.add(pid);
    const children = await optionalRead(`/proc/${pid}/task/${pid}/children`);
    if (children.missing) missing.push({ pid, counter: 'main-thread-children', reason: children.missing });
    if (children.value) queue.push(...children.value.trim().split(/\s+/).filter(Boolean).map(Number));
    if (pid === root) continue;
    const comm = await optionalRead(`/proc/${pid}/comm`);
    if (comm.missing) missing.push({ pid, counter: 'comm', reason: comm.missing });
    if (comm.value && PROCESS_NAMES.test(comm.value.trim())) result.push({ pid, name: comm.value.trim() });
  }
  return { processes: result, missing, traversalBoundReached: queue.length > 0 };
}
export async function readCounters() {
  const counters = Object.fromEntries(await Promise.all(COUNTERS.map(async path => [path, await optionalRead(path)])));
  const group = counters['/proc/self/cgroup'].value?.split('\n').find(line => line.startsWith('0::'))?.slice(3);
  if (group && group.startsWith('/') && !group.split('/').includes('..')) {
    const base = path.join('/sys/fs/cgroup', group);
    for (const file of ['cpu.stat', 'memory.events']) counters[path.join(base, file)] = await optionalRead(path.join(base, file));
  } else counters.cgroupLocation = { missing: 'No valid unified cgroup location' };
  const discovered = await descendants(process.pid);
  const processes = await Promise.all(discovered.processes.map(async ({ pid, name }) => {
    const stat = await optionalRead(`/proc/${pid}/stat`), status = await optionalRead(`/proc/${pid}/status`);
    let parsed; try { parsed = stat.value ? parseProcessStat(stat.value) : stat; } catch (error) { parsed = { missing: String(error) }; }
    let executable; try { executable = await fs.readlink(`/proc/${pid}/exe`); } catch (error) { executable = { missing: error.code }; }
    return { pid, name, stat: parsed, status: status.value ? status.value.split('\n').filter(line => /^(VmRSS|VmHWM|VmSize|Threads):/.test(line)) : status, executable };
  }));
  return { counters, processes, discoveryMissing: discovered.missing, traversalBoundReached: discovered.traversalBoundReached };
}
export function startSampling(records, read = readCounters, intervalMs = 250) {
  let stopped = false, busy = false, pending = Promise.resolve();
  const tick = () => {
    if (stopped || busy || records.length >= 120) return;
    busy = true;
    pending = (async () => {
      const nodeStartMs = performance.now();
      try { records.push({ nodeStartMs, nodeEndMs: performance.now(), ...await read() }); }
      catch (error) { records.push({ nodeStartMs, missing: String(error) }); }
      finally { records.at(-1).nodeEndMs = performance.now(); busy = false; }
    })();
  };
  tick(); const handle = setInterval(tick, intervalMs); handle.unref();
  return async () => { stopped = true; clearInterval(handle); await pending; };
}

// Serialized browser callback. Native APIs saved by pinned Playwright clock are
// deliberately distinct from the installed page APIs. Neither is overwritten.
export function registerNativeObservation(element, { name }) {
  const saved = globalThis.__pwClock?.builtins;
  const keys = ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'];
  if (!saved || keys.some(key => typeof saved[key] !== 'function' || saved[key] === globalThis[key])
    || typeof saved.performance?.now !== 'function' || saved.performance.now === performance.now
    || saved.Date === Date || Date.isFake !== true) throw new Error('Preserved native API admission failed');
  if (globalThis.__wpeActiveObservation) throw new Error('Overlapping native observation');
  const nativeNow = () => saved.performance.now();
  const state = () => { const r = element.getBoundingClientRect(); return {
    connected: element.isConnected, visible: document.visibilityState, focused: document.hasFocus(),
    rect: { x: r.x, y: r.y, width: r.width, height: r.height } }; };
  const record = { name, registeredNativeMs: nativeNow(), registeredPageMs: performance.now(),
    registeredNativeEpochMs: saved.Date.now(), registeredPageEpochMs: Date.now(),
    initial: state(), frames: [], timers: [], emitErrors: [], stopped: false };
  for (const key of ['registeredNativeMs', 'registeredPageMs', 'registeredNativeEpochMs', 'registeredPageEpochMs'])
    if (!Number.isFinite(record[key])) throw new Error('Invalid clock origin');
  if (!record.initial.connected || record.initial.visible !== 'visible' || !record.initial.focused)
    throw new Error('Invisible, detached or unfocused observation target');
  let frameHandle, timerHandle;
  const emit = event => {
    // At most five callbacks per window. Node retains already-delivered events
    // even if the browser is closed by the unchanged test deadline.
    Promise.resolve(globalThis.__wpeDiagnosticEmit({ name, ...event })).catch(error => record.emitErrors.push(String(error)));
  };
  const frame = timestamp => {
    if (record.stopped) return;
    const event = { kind: 'frame', index: record.frames.length + 1,
      nativeMs: nativeNow(), rafTimestamp: timestamp, pageMs: performance.now(), ...state() };
    record.frames.push(event); emit(event);
    if (record.frames.length < 2) frameHandle = saved.requestAnimationFrame.call(globalThis, frame);
  };
  const timer = () => {
    if (record.stopped) return;
    const event = { kind: 'timer', index: record.timers.length + 1, nativeMs: nativeNow(), pageMs: performance.now(), ...state() };
    record.timers.push(event); emit(event);
    if (record.timers.length < 3) timerHandle = saved.setTimeout.call(globalThis, timer, 100);
  };
  frameHandle = saved.requestAnimationFrame.call(globalThis, frame); timerHandle = saved.setTimeout.call(globalThis, timer, 100);
  globalThis.__wpeActiveObservation = { name, stop: () => {
    record.stopped = true; saved.cancelAnimationFrame.call(globalThis, frameHandle); saved.clearTimeout.call(globalThis, timerHandle);
    record.stoppedNativeMs = nativeNow(); record.final = state();
    return record;
  } };
  return { name, registeredNativeMs: record.registeredNativeMs, registeredPageMs: record.registeredPageMs, initial: record.initial };
}
export function stopNativeObservation(name) {
  const active = globalThis.__wpeActiveObservation;
  if (!active || active.name !== name) throw new Error('Mismatched native observation');
  const result = active.stop(); delete globalThis.__wpeActiveObservation; return result;
}
export async function observeWindow({ page, locator, name, windows, work }) {
  const record = { name, nodeStartMs: performance.now(), samples: [], browserEvents: [] };
  windows.push(record);
  let failure, result, stopSampling, monitor;
  try {
    record.registration = await locator.evaluate(registerNativeObservation, { name });
    monitor = monitorEventLoopDelay({ resolution: 20 }); monitor.enable();
    record.resourceStart = process.resourceUsage();
    stopSampling = startSampling(record.samples);
    record.actionNodeStartMs = performance.now();
    result = await work(); record.actionCompleted = true;
  } catch (error) { failure = error; record.error = String(error); }
  finally {
    record.actionNodeEndMs = performance.now();
    if (stopSampling) await stopSampling();
    if (monitor) { monitor.disable(); record.eventLoopDelayNs = {
      min: monitor.min, max: monitor.max, mean: Number.isFinite(monitor.mean) ? monitor.mean : null,
      p50: monitor.percentile(50), p95: monitor.percentile(95), count: monitor.count };
      record.resourceEnd = process.resourceUsage(); }
    try { record.browserFinal = await page.evaluate(stopNativeObservation, name); }
    catch (error) { record.cleanupError = String(error); failure ??= error; }
    record.nodeEndMs = performance.now();
  }
  if (failure) throw failure;
  return result;
}
export async function finishProcessIdentity(windows) {
  const paths = [...new Set(windows.flatMap(w => w.samples.flatMap(s => (s.processes ?? []).map(p => p.executable))).filter(p => typeof p === 'string'))];
  const executables = [];
  for (const path of paths) {
    const item = { path, nodeStartMs: performance.now() }; executables.push(item);
    try { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); item.sha256 = hash.digest('hex'); }
    catch (error) { item.missing = error.code ?? String(error); }
    item.nodeEndMs = performance.now();
  }
  let runner;
  try {
    const require = createRequire(import.meta.url), root = path.dirname(require.resolve('playwright-core/package.json'));
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    const browsers = JSON.parse(await fs.readFile(path.join(root, 'browsers.json'), 'utf8'));
    runner = { playwright: pkg.version, webkit: browsers.browsers.find(value => value.name === 'webkit'),
      headless: true, launchPort: 'WPE per pinned Linux headless launch script; compare actual executable names below' };
  } catch (error) { runner = { missing: error.code ?? String(error) }; }
  return { runner, os: { platform: os.platform(), release: os.release(), arch: os.arch() }, node: process.version,
    ciSource: { sha: process.env.GITHUB_SHA ?? null, ref: process.env.GITHUB_REF ?? null, runId: process.env.GITHUB_RUN_ID ?? null },
    runnerImage: { ImageOS: process.env.ImageOS ?? null, ImageVersion: process.env.ImageVersion ?? null },
    processCounterUnits: { cpu: 'kernel clock ticks, no cross-clock subtraction', rss: 'pages, bytes separately in status' },
    executables, limitation: 'No command lines, environment dump, network data, profiler or permission escalation. Main-thread descendant discovery can miss a child forked by another native thread; missing identity/counters cannot prove an idle browser. Missing process identity is not inferred from expected runner metadata.' };
}
export function readAdmission(element) {
  const css = getComputedStyle(element), root = document.documentElement;
  return { appearance: root.dataset.appearance, theme: root.dataset.theme,
    dpr: devicePixelRatio, width: innerWidth, height: innerHeight,
    visible: document.visibilityState, focused: document.hasFocus(), connected: element.isConnected,
    coarse: matchMedia('(pointer: coarse)').matches, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    filter: css.getPropertyValue('backdrop-filter').trim(), webkitFilter: css.getPropertyValue('-webkit-backdrop-filter').trim(),
    backgroundColor: css.backgroundColor, position: css.position, zIndex: css.zIndex, opacity: css.opacity, rootFont: getComputedStyle(root).fontSize };
}
export function validateAdmission(v) {
  assert.equal(v.appearance, 'pixel'); assert.equal(v.theme, 'light');
  assert.equal(v.dpr, 3); assert.equal(v.width, 1920); assert.equal(v.height, 1080);
  assert.equal(v.visible, 'visible'); assert.equal(v.focused, true); assert.equal(v.connected, true);
  assert.equal(v.coarse, true); assert.equal(v.reduced, true);
  assert.equal(v.position, 'fixed'); assert.equal(v.zIndex, '95'); assert.equal(v.opacity, '1');
  const legacy = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?))?\s*\)$/.exec(v.backgroundColor);
  const srgb = /^color\(srgb\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*\)$/.exec(v.backgroundColor);
  const color = legacy ?? srgb;
  assert.ok(color, 'Unsupported computed pixel paper color');
  assert.ok(color.slice(1, 4).map(Number).every(n => Number.isFinite(n) && n >= 0 && n <= (legacy ? 255 : 1)));
  assert.equal(color[4] === undefined ? 1 : Number(color[4]), 1, 'Pixel paper must be opaque after async CSS import');
  const filters = [v.filter, v.webkitFilter].filter(Boolean);
  assert.ok(filters.length > 0 && filters.every(f => f === 'blur(12px)'), 'Original filter must be retained');
}
export async function measureStep(records, name, work) {
  const r = { name, nodeStartMs: performance.now() }; records.push(r);
  try { const value = await work(); r.completed = true; return value; }
  catch (error) { r.error = String(error); throw error; }
  finally { r.nodeEndMs = performance.now(); }
}
