import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StartupVideo } from './StartupVideo';

class MotionPreference extends EventTarget {
  matches = false;
  setReducedMotion(value: boolean) {
    this.matches = value;
    this.dispatchEvent(Object.assign(new Event('change'), { matches: value }));
  }
}

class PageVisibility extends EventTarget {
  visibilityState = 'visible';
  setHidden(hidden: boolean) {
    this.visibilityState = hidden ? 'hidden' : 'visible';
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

let motion: MotionPreference;
let page: PageVisibility;
let media: { muted: boolean; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>; getAttribute: (key: string) => string | null;
  setAttribute: ReturnType<typeof vi.fn>; removeAttribute: ReturnType<typeof vi.fn> };
let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  motion = new MotionPreference();
  page = new PageVisibility();
  const attributes = new Map([['src', '/provided-video.mp4']]);
  media = { muted: false, play: vi.fn(async () => {}), pause: vi.fn(), load: vi.fn(),
    getAttribute: key => attributes.get(key) ?? null,
    setAttribute: vi.fn((key: string, value: string) => { attributes.set(key, value); }),
    removeAttribute: vi.fn((key: string) => { attributes.delete(key); }),
  };
  vi.stubGlobal('window', { matchMedia: vi.fn(() => motion) });
  vi.stubGlobal('document', page);
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const surface = (src = '/provided-video.mp4') => (
  <StartupVideo src={src} poster="/provided-poster.jpg">
    <span data-testid="static-loading">アプリを準備しています...</span>
  </StartupVideo>
);
const video = () => renderer!.root.findByType('video');
const button = () => renderer!.root.findByType('button');
const expectStaticLoading = () => {
  expect(renderer!.root.findAllByType('video')).toHaveLength(0);
  expect(renderer!.root.findByProps({ 'data-testid': 'static-loading' }).children).toEqual(['アプリを準備しています...']);
};
const mount = async () => {
  await act(async () => {
    renderer = create(surface(), { createNodeMock: node => node.type === 'video' ? media : null });
  });
};

it('requests muted inline autoplay with the supplied source and poster', async () => {
  await mount();
  expect(video().props).toMatchObject({ src: '/provided-video.mp4', poster: '/provided-poster.jpg',
    autoPlay: true, muted: true, playsInline: true, preload: 'auto', 'aria-hidden': 'true', tabIndex: -1 });
  expect(video().props.controls).toBeUndefined();
  expect(video().props.loop).toBeUndefined();
  expect(media.muted).toBe(true);
  expect(media.play).toHaveBeenCalledOnce();
  expect(media.setAttribute).not.toHaveBeenCalled();
  expect(button().props).toMatchObject({ type: 'button', 'aria-label': '起動アニメーションをスキップ' });
});

it('exposes a native skip button whose activation keeps loading', async () => {
  await mount();
  act(() => button().props.onClick());
  expectStaticLoading();
  expect(media.pause).toHaveBeenCalledOnce();
  expect(media.removeAttribute).toHaveBeenCalledExactlyOnceWith('src');
  expect(media.load).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  act(() => renderer!.update(surface()));
  expectStaticLoading();
  expect(media.play).toHaveBeenCalledOnce();
});

it('allows Escape to skip while unrelated keys keep playback', async () => {
  await mount();
  const preventDefault = vi.fn();
  act(() => button().props.onKeyDown({ key: 'ArrowLeft', preventDefault }));
  expect(preventDefault).not.toHaveBeenCalled();
  expect(video()).toBeDefined();
  act(() => button().props.onKeyDown({ key: 'Escape', preventDefault }));
  expect(preventDefault).toHaveBeenCalledOnce();
  expectStaticLoading();
});

it.each(['onEnded', 'onError'])('%s changes only the decoration to static loading', async event => {
  await mount();
  act(() => video().props[event]());
  expectStaticLoading();
  expect(media.pause).toHaveBeenCalledOnce();
});

it.each(['reject', 'throw'])('falls back when autoplay fails via %s', async failure => {
  if (failure === 'reject') media.play.mockRejectedValue(new Error('Playback is unavailable'));
  else media.play.mockImplementation(() => { throw new Error('Playback is unavailable'); });
  await mount();
  expectStaticLoading();
  expect(media.pause).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('falls back if playback does not start without postponing the timeout for repeated stalled events', async () => {
  media.play.mockImplementation(() => new Promise(() => {}));
  await mount();
  act(() => { vi.advanceTimersByTime(3_000); });
  act(() => { video().props.onStalled(); video().props.onWaiting(); });
  act(() => { vi.advanceTimersByTime(1_000); });
  expectStaticLoading();
});

it('does not time out healthy playback and bounds a later stalled interval', async () => {
  await mount();
  act(() => video().props.onPlaying());
  act(() => { vi.advanceTimersByTime(30_000); });
  expect(video()).toBeDefined();
  act(() => video().props.onWaiting());
  act(() => { vi.advanceTimersByTime(3_000); });
  act(() => video().props.onPlaying());
  act(() => { vi.advanceTimersByTime(30_000); });
  expect(video()).toBeDefined();
  act(() => video().props.onStalled());
  act(() => { vi.advanceTimersByTime(4_000); });
  expectStaticLoading();
});

it.each(['reduced-motion', 'hidden'])('does not mount video or request playback when initially %s', async preference => {
  if (preference === 'reduced-motion') motion.matches = true;
  else page.visibilityState = 'hidden';
  await mount();
  expectStaticLoading();
  expect(media.play).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('stops on reduced motion and does not restart if the preference changes back', async () => {
  await mount();
  act(() => motion.setReducedMotion(true));
  expectStaticLoading();
  act(() => motion.setReducedMotion(false));
  expectStaticLoading();
  expect(media.play).toHaveBeenCalledOnce();
});

it('stops on backgrounding and does not replay when the page becomes visible', async () => {
  await mount();
  act(() => page.setHidden(true));
  expectStaticLoading();
  act(() => page.setHidden(false));
  expectStaticLoading();
  expect(media.play).toHaveBeenCalledOnce();
});

it('cleans playback, timeout and listeners immediately when the ready app removes the surface', async () => {
  let rejectPlayback!: (reason: Error) => void;
  media.play.mockImplementation(() => new Promise((_, reject) => { rejectPlayback = reject; }));
  const removeMotion = vi.spyOn(motion, 'removeEventListener');
  const removeVisibility = vi.spyOn(page, 'removeEventListener');
  await mount();
  await act(async () => {
    renderer!.unmount();
    rejectPlayback(new Error('Unmounted before media was ready'));
  });
  expect(media.pause).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  expect(removeMotion).toHaveBeenCalledWith('change', expect.any(Function));
  expect(removeVisibility).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  expect(renderer!.toJSON()).toBeNull();
});

it('ignores rejection from a superseded source playback', async () => {
  let rejectOldPlayback!: (reason: Error) => void;
  media.play.mockImplementationOnce(() => new Promise((_, reject) => { rejectOldPlayback = reject; }));
  await mount();
  act(() => renderer!.update(surface('/replacement-video.mp4')));
  await act(async () => rejectOldPlayback(new Error('Superseded playback')));
  expect(video().props.src).toBe('/replacement-video.mp4');
  expect(media.play).toHaveBeenCalledTimes(2);
  expect(media.pause).toHaveBeenCalledOnce();
  expect(media.getAttribute('src')).toBe('/replacement-video.mp4');
});

it('restores the source if setup reuses an element cleared by prior cleanup', async () => {
  await mount();
  act(() => renderer!.unmount());
  expect(media.getAttribute('src')).toBeNull();
  await mount();
  expect(media.getAttribute('src')).toBe('/provided-video.mp4');
  expect(media.setAttribute).toHaveBeenCalledExactlyOnceWith('src', '/provided-video.mp4');
  expect(media.play).toHaveBeenCalledTimes(2);
});

it('can render with missing optional media-query and visibility APIs', async () => {
  vi.stubGlobal('window', {});
  vi.stubGlobal('document', undefined);
  await mount();
  expect(video()).toBeDefined();
  act(() => button().props.onClick());
  expectStaticLoading();
});
