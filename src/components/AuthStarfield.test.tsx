import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthStarfield } from './AuthStarfield';

let renderer: ReactTestRenderer | undefined;
let page: EventTarget & { visibilityState: string };
let media: EventTarget & { matches: boolean };
beforeEach(() => {
  page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('document', page);
  vi.stubGlobal('window', { matchMedia: vi.fn(() => media) });
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
const mount = () => act(() => { renderer = create(<AuthStarfield />); });
const stars = () => renderer!.root.findByProps({ className: 'auth-stars' });
const button = () => renderer!.root.findByType('button');

it('renders two decorative layers and no media, canvas or timer loop', () => {
  const interval = vi.spyOn(globalThis, 'setInterval'); const timeout = vi.spyOn(globalThis, 'setTimeout');
  mount();
  expect(stars().props).toMatchObject({ 'aria-hidden': 'true', 'data-paused': false });
  expect(stars().findAllByType('div')).toHaveLength(3);
  expect(renderer!.root.findAll(node => ['canvas', 'video', 'img'].includes(String(node.type)))).toHaveLength(0);
  expect(interval).not.toHaveBeenCalled(); expect(timeout).not.toHaveBeenCalled();
  interval.mockRestore(); timeout.mockRestore();
});

it('pauses while the page is hidden and resumes on return', () => {
  mount();
  act(() => { page.visibilityState = 'hidden'; page.dispatchEvent(new Event('visibilitychange')); });
  expect(stars().props['data-paused']).toBe(true);
  act(() => { page.visibilityState = 'visible'; page.dispatchEvent(new Event('visibilitychange')); });
  expect(stars().props['data-paused']).toBe(false);
});

it('starts paused in an already hidden document', () => {
  page.visibilityState = 'hidden'; mount(); expect(stars().props['data-paused']).toBe(true);
});

it('preserves a manual pause across hide/show and supports explicit resume', () => {
  mount(); act(() => button().props.onClick());
  expect(button().props['aria-label']).toBe('星の動きを再開');
  act(() => { page.visibilityState = 'hidden'; page.dispatchEvent(new Event('visibilitychange')); });
  act(() => { page.visibilityState = 'visible'; page.dispatchEvent(new Event('visibilitychange')); });
  expect(stars().props['data-paused']).toBe(true);
  act(() => button().props.onClick()); expect(stars().props['data-paused']).toBe(false);
});

it('shows static stars without an inactive motion button for initial reduced motion', () => {
  media.matches = true; mount();
  expect(stars().props['data-paused']).toBe(true); expect(renderer!.root.findAllByType('button')).toHaveLength(0);
});

it('responds to reduced-motion changes and does not override a manual pause', () => {
  mount(); act(() => button().props.onClick());
  act(() => { media.matches = true; media.dispatchEvent(new Event('change')); });
  expect(stars().props['data-paused']).toBe(true); expect(renderer!.root.findAllByType('button')).toHaveLength(0);
  act(() => { media.matches = false; media.dispatchEvent(new Event('change')); });
  expect(stars().props['data-paused']).toBe(true); expect(button().props['aria-label']).toBe('星の動きを再開');
});

it('cleans up both lifecycle subscriptions when leaving authentication', () => {
  const removePage = vi.spyOn(page, 'removeEventListener'); const removeMedia = vi.spyOn(media, 'removeEventListener');
  mount(); act(() => renderer!.unmount()); renderer = undefined;
  expect(removePage).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  expect(removeMedia).toHaveBeenCalledWith('change', expect.any(Function));
});
