import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SplashScreen } from './SplashScreen';
import { StartupSurface, useStartupContentVisible } from './StartupSurface';
import type { StartupVideoOutcome } from './StartupVideo';

let renderer: ReactTestRenderer | undefined;
const onVisibilityChange = vi.fn();
const Probe = () => <span data-testid="protected" data-visible={useStartupContentVisible()}>protected content</span>;
const surface = (loading: boolean) => <StartupSurface loading={loading} onVisibilityChange={onVisibilityChange}><Probe /></StartupSurface>;
const visible = () => renderer!.root.findByProps({ 'data-testid': 'protected' }).props['data-visible'];
const splash = () => renderer!.root.findByType(SplashScreen);
beforeEach(() => {
  onVisibilityChange.mockClear();
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
it('ready alone preserves the same playing clip and enables the hint until actual ended', () => {
  act(() => { renderer = create(surface(true)); });
  const clip = renderer!.root.findByType('video');
  expect(visible()).toBe(false); expect(splash().props.canSkip).toBe(false);
  act(() => renderer!.update(surface(false)));
  expect(renderer!.root.findByType('video')).toBe(clip);
  expect(visible()).toBe(false); expect(splash().props.canSkip).toBe(true);
  expect(renderer!.root.findByType('p').children).toEqual(['準備できました']);
  act(() => clip.props.onEnded());
  expect(visible()).toBe(true); expect(renderer!.root.findAllByType(SplashScreen)).toHaveLength(0);
  expect(onVisibilityChange.mock.calls.map(([value]) => value)).toEqual([false, true]);
});
it('ended first retains the still and loading until the current app is ready', () => {
  act(() => { renderer = create(surface(true)); });
  act(() => renderer!.root.findByType('video').props.onEnded());
  expect(visible()).toBe(false); expect(splash().props.videoOutcome).toBe('ended');
  expect(renderer!.root.findByType('img').props.alt).toBe('Laplance');
  act(() => renderer!.update(surface(false)));
  expect(visible()).toBe(true);
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
