import { afterEach, expect, it, vi } from 'vitest';
import { reloadWithStartupTiming, startupTimingNavigationUrl } from './startupTimingNavigation';

afterEach(() => vi.unstubAllGlobals());

it.each([true, false])('changes only the timing switch while preserving origin, path, raw queries and fragment: %s', enabled => {
  const url = 'https://example.test/app%2Fpage?value=a%20b&value=c+d&empty=&flag&startupTiming=0&%73tartupTiming=1&startupTransport=streaming&startupProfile=observe&startupMarker=off#tab?startupTiming=1';
  const retained = 'https://example.test/app%2Fpage?value=a%20b&value=c+d&empty=&flag&startupTransport=streaming&startupProfile=observe&startupMarker=off';
  expect(startupTimingNavigationUrl(url, enabled)).toBe(`${retained}${enabled ? '&startupTiming=1' : ''}#tab?startupTiming=1`);
});

it('starts once without duplicating an existing switch and completely removes it when stopping', () => {
  const normal = 'https://example.test/#home';
  const started = startupTimingNavigationUrl(normal, true);
  expect(started).toBe('https://example.test/?startupTiming=1#home');
  expect(startupTimingNavigationUrl(started, true)).toBe(started);
  expect(startupTimingNavigationUrl(started, false)).toBe(normal);
});

it('uses replace on the current context only and never touches storage, auth or a separate window', () => {
  const replace = vi.fn();
  const forbidden = vi.fn(() => { throw new Error('unexpected effect'); });
  vi.stubGlobal('window', { location: { href: 'https://example.test/nested?a=%2B#part', replace },
    get localStorage() { return forbidden(); }, get sessionStorage() { return forbidden(); }, open: forbidden });
  vi.stubGlobal('fetch', forbidden);
  expect(replace).not.toHaveBeenCalled();
  reloadWithStartupTiming(true);
  expect(replace).toHaveBeenCalledExactlyOnceWith('https://example.test/nested?a=%2B&startupTiming=1#part');
  expect(forbidden).not.toHaveBeenCalled();
});

it('retains a literal question-mark-prefixed parameter instead of treating it as a timing switch', () => {
  const source = 'https://example.test/?x=1&?startupTiming=keep&startupTiming=1#hash';
  expect(startupTimingNavigationUrl(source, false)).toBe('https://example.test/?x=1&?startupTiming=keep#hash');
  expect(startupTimingNavigationUrl(source, true)).toBe(source);
});
