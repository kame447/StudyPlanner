import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SplashScreen } from './SplashScreen';
import { StartupSurface, useStartupContentVisible } from './StartupSurface';
import { createStartupTimingRecorder } from '../lib/startupTiming';
import type { StartupVideoOutcome } from './StartupVideo';

const timing = vi.hoisted(() => ({ now: 0, recorder: null as unknown as ReturnType<typeof createStartupTimingRecorder> }));
vi.mock('../lib/startupTiming', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/startupTiming')>(),
  startupTiming: {
    begin: (...args: Parameters<typeof timing.recorder.begin>) => timing.recorder.begin(...args),
    markOnce: (...args: Parameters<typeof timing.recorder.markOnce>) => timing.recorder.markOnce(...args),
    markIntroComplete: (...args: Parameters<typeof timing.recorder.markIntroComplete>) => timing.recorder.markIntroComplete(...args),
  },
}));
const diagnosticRows = () => timing.recorder.getSnapshot().filter(row => row.phase !== 'splash-mounted');
let renderer: ReactTestRenderer | undefined;
const onVisibilityChange = vi.fn();
const Probe = () => <span data-testid="protected" data-visible={useStartupContentVisible()}>protected content</span>;
const surface = (loading: boolean) => <StartupSurface loading={loading} onVisibilityChange={onVisibilityChange}><Probe /></StartupSurface>;
const visible = () => renderer!.root.findByProps({ 'data-testid': 'protected' }).props['data-visible'];
const splash = () => renderer!.root.findByType(SplashScreen);
beforeEach(() => {
  onVisibilityChange.mockClear();
  timing.now = 0; timing.recorder = createStartupTimingRecorder(true, () => timing.now);
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
it('ready alone preserves the same playing clip and enables the hint until actual ended', () => {
  act(() => { renderer = create(surface(true)); });
  const clip = renderer!.root.findByType('video');
  expect(visible()).toBe(false); expect(splash().props.canSkip).toBe(false);
  timing.now = 200;
  act(() => renderer!.update(surface(false)));
  expect(diagnosticRows()).toMatchObject([{ phase: 'startup-wait-ended', startMs: 200 }]);
  expect(renderer!.root.findByType('video')).toBe(clip);
  expect(visible()).toBe(false); expect(splash().props.canSkip).toBe(true);
  expect(renderer!.root.findByType('p').children).toEqual(['準備できました']);
  timing.now = 5_000;
  act(() => clip.props.onEnded());
  expect(diagnosticRows()).toMatchObject([
    { phase: 'startup-wait-ended', startMs: 200 },
    { phase: 'intro-complete', startMs: 5_000, introOutcome: 'ended' },
  ]);
  expect(visible()).toBe(true); expect(renderer!.root.findAllByType(SplashScreen)).toHaveLength(0);
  expect(onVisibilityChange.mock.calls.map(([value]) => value)).toEqual([false, true]);
});
it('ended first retains the still and loading until the current app is ready', () => {
  act(() => { renderer = create(surface(true)); });
  timing.now = 100;
  act(() => renderer!.root.findByType('video').props.onEnded());
  expect(diagnosticRows()).toMatchObject([{ phase: 'intro-complete', startMs: 100, introOutcome: 'ended' }]);
  expect(visible()).toBe(false); expect(splash().props.videoOutcome).toBe('ended');
  expect(renderer!.root.findByType('img').props.alt).toBe('Laplance');
  timing.now = 300;
  act(() => renderer!.update(surface(false)));
  expect(visible()).toBe(true);
  expect(diagnosticRows()).toMatchObject([
    { phase: 'intro-complete', startMs: 100, introOutcome: 'ended' },
    { phase: 'startup-wait-ended', startMs: 300 },
  ]);
});
it('current readiness rejects even a retained completion callback, then accepts a ready tap', () => {
  act(() => { renderer = create(surface(false)); });
  const finish = splash().props.onVideoComplete;
  act(() => renderer!.update(surface(true)));
  act(() => finish('skipped'));
  expect(splash().props.videoOutcome).toBeNull(); expect(visible()).toBe(false);
  act(() => renderer!.root.findByType('button').props.onClick());
  expect(splash().props.videoOutcome).toBeNull();
  act(() => renderer!.update(surface(false)));
  act(() => renderer!.root.findByType('button').props.onClick());
  expect(visible()).toBe(true);
});
it.each<StartupVideoOutcome>(['media-error', 'autoplay-blocked', 'stalled', 'reduced-motion'])(
  '%s releases only a ready application and retains its distinct outcome', reason => {
    act(() => { renderer = create(surface(true)); });
    act(() => splash().props.onVideoComplete(reason));
    expect(splash().props.videoOutcome).toBe(reason); expect(visible()).toBe(false);
    expect(diagnosticRows()).toMatchObject([{ phase: 'intro-complete', introOutcome: reason }]);
    act(() => renderer!.update(surface(false))); expect(visible()).toBe(true);
  });
it('a later data reload keeps the completed still rather than replaying or bypassing readiness', () => {
  act(() => { renderer = create(surface(false)); });
  act(() => renderer!.root.findByType('video').props.onEnded());
  expect(visible()).toBe(true);
  act(() => renderer!.update(surface(true)));
  expect(visible()).toBe(false); expect(splash().props.videoOutcome).toBe('ended');
  expect(renderer!.root.findAllByType('video')).toHaveLength(0);
  act(() => renderer!.update(surface(false))); expect(visible()).toBe(true);
});

it('records distinct wait exits without treating rerenders or stale sessions as another exit', () => {
  let current = false;
  const isCurrent = () => current;
  const render = (loading: boolean) => <StartupSurface loading={loading} isCurrent={isCurrent}><Probe /></StartupSurface>;
  act(() => { renderer = create(render(false)); });
  expect(diagnosticRows()).toEqual([]);
  current = true;
  act(() => renderer!.update(render(true)));
  timing.now = 100;
  act(() => renderer!.update(render(false)));
  act(() => renderer!.update(render(false)));
  expect(diagnosticRows()).toMatchObject([{ phase: 'startup-wait-ended', startMs: 100 }]);
  act(() => renderer!.update(render(true)));
  timing.now = 200;
  act(() => renderer!.update(render(false)));
  expect(diagnosticRows()).toMatchObject([
    { phase: 'startup-wait-ended', startMs: 100 },
    { phase: 'startup-wait-ended', startMs: 200 },
  ]);
});

it('keeps diagnostics disabled while preserving ready-first and accepted skip behavior', () => {
  const now = vi.fn(() => 5);
  timing.recorder = createStartupTimingRecorder(false, now);
  act(() => { renderer = create(surface(true)); });
  act(() => renderer!.update(surface(false)));
  expect(visible()).toBe(false);
  act(() => renderer!.root.findByType('button').props.onClick());
  expect(visible()).toBe(true);
  expect(timing.recorder.getSnapshot()).toEqual([]);
  expect(now).not.toHaveBeenCalled();
});

it('records only the accepted first intro outcome and never records a rejected skip', () => {
  act(() => { renderer = create(surface(true)); });
  const finish = splash().props.onVideoComplete;
  act(() => finish('skipped'));
  expect(diagnosticRows()).toEqual([]);
  timing.now = 100;
  act(() => renderer!.update(surface(false)));
  timing.now = 200;
  act(() => finish('skipped'));
  timing.now = 300;
  act(() => finish('ended'));
  expect(diagnosticRows()).toMatchObject([
    { phase: 'startup-wait-ended', startMs: 100 },
    { phase: 'intro-complete', startMs: 200, introOutcome: 'skipped' },
  ]);
});
