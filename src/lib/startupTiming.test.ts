import { describe, expect, it, vi } from 'vitest';
import { createStartupTimingRecorder, STARTUP_INTRO_OUTCOMES, type StartupIntroOutcome, type StartupPhase } from './startupTiming';

describe('local startup timing', () => {
  it('is inert when disabled, preserving the exact promise and sync failure', () => {
    const now = vi.fn(() => 1);
    const recorder = createStartupTimingRecorder(false, now);
    const promise = Promise.resolve({ privateValue: 'not-recorded' });
    expect(recorder.measure('profile', () => promise)).toBe(promise);
    const error = new Error('private error');
    expect(() => recorder.measure('memory', () => { throw error; })).toThrow(error);
    recorder.begin('consent')(); recorder.markOnce('home-visible');
    expect(recorder.getSnapshot()).toEqual([]);
    expect(now).not.toHaveBeenCalled();
  });

  it('records concurrent spans without serializing them or exposing results/errors', async () => {
    let now = 20;
    const recorder = createStartupTimingRecorder(true, () => now);
    let first!: (value: object) => void;
    let second!: (reason: unknown) => void;
    const value = { owner: 'private-user', token: 'private-token' };
    const error = new Error('private-failure');
    const a = recorder.measure('plans', () => new Promise<object>(resolve => { first = resolve; }));
    now = 22;
    const b = recorder.measure('actuals', () => new Promise<void>((_, reject) => { second = reject; }));
    expect(recorder.getSnapshot().map(row => row.outcome)).toEqual(['pending', 'pending']);
    now = 70; first(value); expect(await a).toBe(value);
    now = 100; second(error); await expect(b).rejects.toBe(error);
    expect(recorder.getSnapshot()).toEqual([
      { id: 1, phase: 'plans', startMs: 20, durationMs: 50, outcome: 'success' },
      { id: 2, phase: 'actuals', startMs: 22, durationMs: 78, outcome: 'error' },
    ]);
    expect(JSON.stringify(recorder.getSnapshot())).not.toContain('private-');
  });

  it('bounds the recorder and ends collection after the first visible Home', () => {
    const recorder = createStartupTimingRecorder(true, () => 10);
    recorder.markOnce('splash-mounted'); recorder.markOnce('splash-mounted');
    const finish = recorder.begin('memory'); finish('cancelled'); finish();
    recorder.markOnce('home-visible'); recorder.begin('profile')();
    expect(recorder.getSnapshot().map(row => row.phase)).toEqual(['splash-mounted', 'memory', 'home-visible']);
    expect(recorder.getSnapshot()[1].outcome).toBe('cancelled');
    const capped = createStartupTimingRecorder(true, () => 10);
    capped.begin('private-name' as StartupPhase)();
    for (let i = 0; i < 100; i++) capped.begin('profile')();
    expect(capped.getSnapshot()).toHaveLength(80);
  });

  it('keeps snapshots stable until events and cannot break startup on diagnostics failures', async () => {
    const recorder = createStartupTimingRecorder(true, () => { throw new Error('clock'); });
    const listener = vi.fn(); const unsubscribe = recorder.subscribe(listener);
    recorder.subscribe(() => { throw new Error('observer'); });
    const before = recorder.getSnapshot(); expect(recorder.getSnapshot()).toBe(before);
    await expect(recorder.measure('profile', async () => 42)).resolves.toBe(42);
    expect(recorder.getSnapshot()).not.toBe(before);
    expect(recorder.getSnapshot()[0]).toMatchObject({ startMs: 0, durationMs: 0, outcome: 'success' });
    expect(listener).toHaveBeenCalledTimes(2); unsubscribe(); recorder.begin('plans')();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

it.each(STARTUP_INTRO_OUTCOMES)('records only a fixed intro outcome once: %s', reason => {
  let now = 100;
  const recorder = createStartupTimingRecorder(true, () => now);
  recorder.markIntroComplete('private-error' as StartupIntroOutcome);
  expect(recorder.getSnapshot()).toEqual([]);
  recorder.markIntroComplete(reason);
  now = 200;
  recorder.markIntroComplete('ended');
  expect(recorder.getSnapshot()).toEqual([
    { id: 1, phase: 'intro-complete', startMs: 100, durationMs: 0, outcome: 'success', introOutcome: reason },
  ]);
});

it('keeps intro observations inert when disabled and after the first visible Home', () => {
  const now = vi.fn(() => 5);
  const disabled = createStartupTimingRecorder(false, now);
  disabled.markIntroComplete('ended');
  expect(disabled.getSnapshot()).toEqual([]); expect(now).not.toHaveBeenCalled();
  const closed = createStartupTimingRecorder(true, now);
  closed.markOnce('home-visible');
  closed.markIntroComplete('stalled');
  closed.begin('startup-wait-ended')();
  expect(closed.getSnapshot().map(row => row.phase)).toEqual(['home-visible']);
});
