import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { StudyStreakFlame } from './StudyStreakFlame';

let renderer: ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it('is static without real study today and follows later corrections', () => {
  act(() => { renderer = create(<StudyStreakFlame studiedToday={false} />); });
  const flame = () => renderer!.root.findByType('svg');
  expect(flame().props.className).not.toContain('is-studied-today');
  expect(flame().props['aria-hidden']).toBe('true');
  act(() => renderer!.update(<StudyStreakFlame studiedToday />));
  expect(flame().props.className).toContain('is-studied-today');
  act(() => renderer!.update(<StudyStreakFlame studiedToday={false} />));
  expect(flame().props.className).not.toContain('is-studied-today');
});

it('stops in a hidden tab, resumes only when visible and removes its listener', () => {
  const page = Object.assign(new EventTarget(), { visibilityState: 'hidden' });
  const remove = vi.spyOn(page, 'removeEventListener');
  vi.stubGlobal('document', page);
  act(() => { renderer = create(<StudyStreakFlame studiedToday />); });
  const moving = () => renderer!.root.findByType('svg').props.className.includes('is-studied-today');
  expect(moving()).toBe(false);
  act(() => { page.visibilityState = 'visible'; page.dispatchEvent(new Event('visibilitychange')); });
  expect(moving()).toBe(true);
  act(() => { page.visibilityState = 'hidden'; page.dispatchEvent(new Event('visibilitychange')); });
  expect(moving()).toBe(false);
  act(() => renderer!.unmount()); renderer = undefined;
  expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
});
