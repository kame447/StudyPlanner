import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { useThemePreference } from '../hooks/useThemePreference';
import { PublicPageBoundary } from './PublicPageBoundary';
import { PublicPageLink } from './PublicPageLink';

vi.mock('./LegalPage', () => ({ LegalPage: () => <PublicPageLink href="/">Return</PublicPageLink> }));
let renderer: ReactTestRenderer | undefined;
let theme: ReturnType<typeof useThemePreference>;
function Planner() { theme = useThemePreference(); return <PublicPageLink href="/contact">Contact</PublicPageLink>; }
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it.each(['/contact', '/terms', '/privacy'])('restores stored appearance on direct %s and relinquishes theme ownership once the planner starts', path => {
  const values = new Map([['study-planner-theme-mode', 'dark'], ['study-planner-theme-palette', 'ocean']]);
  const css = new Map<string, string>();
  const dataset = { theme: '' };
  const listeners = new Set<() => void>();
  const location = { pathname: path };
  const getItem = vi.fn((key: string) => values.get(key) ?? null);
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('document', { documentElement: { dataset, style: { setProperty: (key: string, value: string) => css.set(key, value) } } });
  vi.stubGlobal('window', { location,
    history: { state: null, pushState: (_state: unknown, _title: string, next: string) => { location.pathname = next; } },
    localStorage: { getItem, setItem: (key: string, value: string) => values.set(key, value) },
    addEventListener: (_name: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_name: string, listener: () => void) => listeners.delete(listener),
    dispatchEvent: () => { [...listeners].forEach(listener => listener()); },
  });
  const mount = () => act(() => { renderer = create(<PublicPageBoundary><Planner /></PublicPageBoundary>); });
  const click = (href: string) => act(() => renderer!.root.findAllByType('a').find(link => link.props.href === href)!.props.onClick({ button: 0, preventDefault: vi.fn() }));
  mount();
  expect(dataset.theme).toBe('dark'); expect(css.get('--accent')).toBe('#6fb2ff');
  expect(renderer!.root.findAllByType(Planner)).toHaveLength(0);
  act(() => renderer!.unmount()); mount(); // A direct public reload still restores the preference.
  expect(dataset.theme).toBe('dark'); expect(css.get('--accent')).toBe('#6fb2ff');
  click('/'); expect(renderer!.root.findAllByType(Planner)).toHaveLength(1);
  const readsAfterStart = getItem.mock.calls.length;
  act(() => theme.setThemePalette('sakura'));
  click('/contact');
  expect(css.get('--accent')).toBe('#ef94ba');
  expect(getItem).toHaveBeenCalledTimes(readsAfterStart);
  click('/');
  expect(css.get('--accent')).toBe('#ef94ba');
  expect(getItem).toHaveBeenCalledTimes(readsAfterStart);
});
