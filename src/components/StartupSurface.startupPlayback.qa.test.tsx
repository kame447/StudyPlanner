// Independent contract probes. Controlled media is not native autoplay/decoding evidence.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StartupSurface, useStartupContentVisible } from './StartupSurface';
import { SplashScreen } from './SplashScreen';
import { MOTION_STORAGE_KEY, resetMotionPreferenceForTests, setMotionPreference } from '../lib/motionPreference';

class Query extends EventTarget { matches = false; }
class Page extends EventTarget {
  visibilityState = 'visible';
  documentElement = { dataset: {} };
  hide(value: boolean) {
    this.visibilityState = value ? 'hidden' : 'visible';
    this.dispatchEvent(new Event('visibilitychange'));
  }
}
let renderer: ReactTestRenderer | undefined;
let query: Query;
let page: Page;
let storage: Map<string, string>;
let media: { currentTime: number; muted: boolean; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>; getAttribute: (key: string) => string | null;
  setAttribute: (key: string, value: string) => void; removeAttribute: (key: string) => void };
const Content = () => <span data-testid="qa-content" data-visible={useStartupContentVisible()}>Application</span>;
const tree = (loading: boolean) => <StartupSurface loading={loading}><Content /></StartupSurface>;
const visible = () => renderer!.root.findByProps({ 'data-testid': 'qa-content' }).props['data-visible'];
const videos = () => renderer!.root.findAllByType('video');
const buttons = (name: string) => renderer!.root.findAllByType('button').filter(node => node.props['aria-label'] === name);
const blocked = () => new DOMException('Synthetic user activation required', 'NotAllowedError');
async function mount(loading: boolean) {
  await act(async () => { renderer = create(tree(loading), { createNodeMock: node => {
    if (node.type !== 'video') return null;
    media.setAttribute('src', node.props.src); return media;
  } }); });
}
function ready() { act(() => renderer!.update(tree(false))); }
function ended() { act(() => videos()[0].props.onEnded()); }
function assertBlocked() {
  expect(videos()).toHaveLength(1);
  expect(visible()).toBe(false);
  expect(renderer!.root.findByType(SplashScreen).props.videoOutcome).toBeNull();
  expect(buttons('起動アニメーションを再生')).toHaveLength(0);
}
beforeEach(() => {
  vi.useFakeTimers(); resetMotionPreferenceForTests();
  query = new Query(); page = new Page(); storage = new Map();
  const browser = new EventTarget();
  Object.assign(browser, { matchMedia: () => query, localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } });
  vi.stubGlobal('window', browser); vi.stubGlobal('document', page);
  const attributes = new Map<string, string>();
  media = { currentTime: 0, muted: false, play: vi.fn(async () => {}), pause: vi.fn(), load: vi.fn(),
    getAttribute: key => attributes.get(key) ?? null, setAttribute: (key, value) => { attributes.set(key, value); },
    removeAttribute: key => { attributes.delete(key); } };
});
afterEach(() => {
  act(() => renderer?.unmount()); renderer = undefined;
  resetMotionPreferenceForTests(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it.each([undefined, 'standard', 'reduced', 'off'].flatMap(stored => [false, true].map(system => ({ stored, system }))))(
  'initial app setting $stored respects OS reduced=$system without app-motion bypass', async ({ stored, system }) => {
    if (stored) storage.set(MOTION_STORAGE_KEY, stored); query.matches = system;
    await mount(true);
    expect(videos()).toHaveLength(system ? 0 : 1);
    expect(media.play).toHaveBeenCalledTimes(system ? 0 : 1);
    expect(visible()).toBe(false);
    ready(); expect(visible()).toBe(system);
    if (!system) {
      expect(videos()).toHaveLength(1);
      expect(media.pause).not.toHaveBeenCalled();
      ended(); expect(visible()).toBe(true);
    }
  },
);
it.each([true, false])('initial hidden waits for visible and ended, initial loading=%s', async loading => {
  page.hide(true); await mount(loading);
  expect(videos()).toHaveLength(0); expect(media.play).not.toHaveBeenCalled(); expect(visible()).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); }); ready();
  expect(visible()).toBe(false);
  await act(async () => page.hide(false));
  expect(videos()).toHaveLength(1); expect(media.play).toHaveBeenCalledOnce(); expect(visible()).toBe(false);
  ended(); expect(visible()).toBe(true);
});
it('ended before data readiness retains the still and never releases pending content', async () => {
  await mount(true); ended();
  expect(videos()).toHaveLength(0); expect(visible()).toBe(false);
  expect(renderer!.root.findByType(SplashScreen).props.videoOutcome).toBe('ended');
  ready(); expect(visible()).toBe(true);
});
it.each(['reject', 'throw'] as const)('NotAllowedError %s retries automatically without releasing pending content', async kind => {
  if (kind === 'reject') media.play.mockRejectedValueOnce(blocked());
  else media.play.mockImplementationOnce(() => { throw blocked(); });
  await mount(true); assertBlocked();
  await act(async () => { await vi.advanceTimersByTimeAsync(249); });
  expect(media.play).toHaveBeenCalledOnce();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(media.play).toHaveBeenCalledTimes(2);
  expect(buttons('起動アニメーションをスキップ').every(button => button.props.disabled)).toBe(true);
  expect(videos()).toHaveLength(1); expect(visible()).toBe(false);
  ended(); expect(visible()).toBe(false); ready(); expect(visible()).toBe(true);
});
it.each([true, false])('persistent denial remains bounded without bypassing readiness, initial loading=%s', async loading => {
  media.play.mockRejectedValue(blocked());
  await mount(loading); assertBlocked();
  await act(async () => { await vi.advanceTimersByTimeAsync(3_999); });
  assertBlocked(); expect(media.play).toHaveBeenCalledTimes(4);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(videos()).toHaveLength(0);
  if (loading) expect(renderer!.root.findByType(SplashScreen).props.videoOutcome).toBe('stalled');
  expect(visible()).toBe(!loading);
  ready(); expect(visible()).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(media.play).toHaveBeenCalledTimes(4);
});
it('a second denial retries automatically and later successful play still requires ended', async () => {
  media.play.mockRejectedValueOnce(blocked()).mockRejectedValueOnce(blocked());
  await mount(false); assertBlocked();
  await act(async () => { await vi.advanceTimersByTimeAsync(250); }); assertBlocked();
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(media.play).toHaveBeenCalledTimes(3);
  expect(visible()).toBe(false); ended(); expect(visible()).toBe(true);
});
it('an obsolete hidden attempt cannot replace the resumed denial or release content', async () => {
  let reject!: (reason: unknown) => void;
  media.play.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockRejectedValueOnce(blocked());
  await mount(false); act(() => page.hide(true));
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); page.hide(false); });
  assertBlocked();
  await act(async () => reject(new DOMException('Old interrupted attempt', 'AbortError'))); assertBlocked();
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(media.play).toHaveBeenCalledTimes(3); expect(visible()).toBe(false); ended(); expect(visible()).toBe(true);
});
it('an OS reduced-motion change is respected while autoplay is blocked', async () => {
  media.play.mockRejectedValueOnce(blocked()); await mount(false); assertBlocked();
  act(() => { query.matches = true; query.dispatchEvent(new Event('change')); });
  expect(visible()).toBe(true); expect(videos()).toHaveLength(0);
  expect(media.play).toHaveBeenCalledOnce();
});
it('app off and reduced changes do not interrupt healthy startup playback', async () => {
  await mount(false);
  for (const value of ['off', 'reduced', 'standard'] as const) {
    act(() => { expect(setMotionPreference(value)).toBe(true); });
    expect(videos()).toHaveLength(1); expect(visible()).toBe(false); expect(media.play).toHaveBeenCalledOnce();
    expect(media.pause).not.toHaveBeenCalled();
  }
  ended(); expect(visible()).toBe(true);
});
