import { useEffect, useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsNavigation } from '../hooks/useSettingsNavigation';
import { createFakeAuthSession } from '../test/fakeAuthSession';
import { createAuthSessionService } from '../services/authSession';
import { getInquiryDraft } from '../services/inquiryDraft';
import { submitInquiry } from '../services/inquiryService';
import { AppSettingsSupportPanel } from './AppSettingsSupportPanel';
import { PublicPageBoundary } from './PublicPageBoundary';
import { PublicPageLink, usePublicPageNavigation } from './PublicPageLink';

vi.mock('../hooks/useThemePreference', () => ({ useThemePreference: vi.fn() }));
vi.mock('../services/authSession', () => ({ createAuthSessionService: vi.fn() }));
vi.mock('../services/inquiryService', () => ({ submitInquiry: vi.fn(), recoverInquiryReceipt: vi.fn() }));
vi.mock('../services/inquiryAttachmentService', () => ({ inquiryAttachmentsAvailable: vi.fn(async () => false), uploadInquiryAttachments: vi.fn() }));
let renderer: ReactTestRenderer | undefined;
let auth: ReturnType<typeof createFakeAuthSession>;
const mounted = vi.fn();
const unmounted = vi.fn();
let navigation: NonNullable<ReturnType<typeof usePublicPageNavigation>>;
let settings: ReturnType<typeof useSettingsNavigation>;

function Planner() {
  navigation = usePublicPageNavigation()!;
  settings = useSettingsNavigation();
  const [draft, setDraft] = useState('');
  useEffect(() => { mounted(); return unmounted; }, []);
  return <>
    <input value={draft} onChange={event => setDraft(event.target.value)} />
    <PublicPageBoundary><AppSettingsSupportPanel /></PublicPageBoundary>
  </>;
}
function browser(pathname = '/', state: unknown = { unrelated: 'preserved' }) {
  const entries = [{ pathname, state }];
  let index = 0;
  const events = new Map<string, Set<() => void>>();
  const location = { get pathname() { return entries[index].pathname; } };
  const history = {
    get state() { return entries[index].state; }, get length() { return entries.length; },
    pushState: vi.fn((next: unknown, _title: string, path = location.pathname) => {
      entries.splice(index + 1); entries.push({ pathname: path, state: next }); index++;
    }),
    replaceState: vi.fn((next: unknown) => { entries[index].state = next; }),
    back: vi.fn(),
  };
  const dispatchEvent = (event: Event) => { [...events.get(event.type) ?? []].forEach(listener => listener()); return true; };
  vi.stubGlobal('window', { location, history, scrollX: 0, scrollY: 30, scrollTo: vi.fn(), dispatchEvent,
    addEventListener: (name: string, listener: () => void) => {
      if (!events.has(name)) events.set(name, new Set()); events.get(name)!.add(listener);
    },
    removeEventListener: (name: string, listener: () => void) => events.get(name)?.delete(listener),
  });
  return { history, location, entries, events, pop(to: number) {
    act(() => { index = to; dispatchEvent(new Event('popstate')); });
  } };
}
function click(href: string, event: Record<string, unknown> = {}) {
  const preventDefault = vi.fn();
  act(() => renderer!.root.findAllByType('a').find(link => link.props.href === href)!.props.onClick({
    button: 0, preventDefault, ...event,
  }));
  return preventDefault;
}
function mount() { act(() => { renderer = create(<PublicPageBoundary><Planner /></PublicPageBoundary>); }); }
beforeEach(() => {
  vi.clearAllMocks();
  auth = createFakeAuthSession({ available: false });
  vi.mocked(createAuthSessionService).mockReturnValue(auth.session);
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; getInquiryDraft().dispose(); vi.unstubAllGlobals(); });

describe('same-document public pages', () => {
  it('preserves the started planner and draft through settings, contact, Back, Forward and explicit return', () => {
    const b = browser(); mount();
    act(() => renderer!.root.findByType('input').props.onChange({ target: { value: 'unsaved plan' } }));
    act(() => settings.open());
    expect(settings.isOpen).toBe(true);
    const originState = b.history.state;
    expect(click('/contact')).toHaveBeenCalledOnce();
    expect(b.location.pathname).toBe('/contact');
    expect(b.history.state).toEqual(originState);
    expect(renderer!.root.findByProps({ className: 'public-page-planner' }).props.hidden).toBe(true);
    expect(mounted).toHaveBeenCalledTimes(1); expect(unmounted).not.toHaveBeenCalled();
    // A duplicate link activation must not add another entry.
    act(() => navigation.navigate('/contact'));
    expect(b.entries).toHaveLength(3);
    b.pop(1); expect(settings.isOpen).toBe(true);
    expect(renderer!.root.findAllByProps({ className: 'public-page-surface' })).toHaveLength(0);
    b.pop(2); expect(b.location.pathname).toBe('/contact');
    click('/');
    expect(b.location.pathname).toBe('/'); expect(settings.isOpen).toBe(false);
    expect(b.history.state).toEqual({ unrelated: 'preserved' });
    expect(renderer!.root.findByType('input').props.value).toBe('unsaved plan');
    expect(mounted).toHaveBeenCalledTimes(1); expect(unmounted).not.toHaveBeenCalled();
    b.pop(2); b.pop(3);
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it.each(['/contact', '/terms', '/privacy'])('defers the planner on direct %s, starts it once on return, and keeps it on Back', path => {
    const b = browser(path); mount();
    expect(mounted).not.toHaveBeenCalled();
    expect(renderer!.root.findAllByType('main')).toHaveLength(1);
    click('/'); expect(mounted).toHaveBeenCalledTimes(1);
    b.pop(0); expect(unmounted).not.toHaveBeenCalled();
    b.pop(1); expect(mounted).toHaveBeenCalledTimes(1);
  });

  it('keeps the same pending contact receipt on leave and Forward without replaying a send', async () => {
    let finish!: (receipt: string) => void;
    vi.mocked(submitInquiry).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    auth = createFakeAuthSession(); vi.mocked(createAuthSessionService).mockReturnValue(auth.session);
    const b = browser(); mount(); click('/contact');
    act(() => auth.emit({ id: 'user', requiresEmailVerification: false }));
    act(() => renderer!.root.findByType('textarea').props.onChange({ target: { value: 'private draft' } }));
    act(() => renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
    click('/');
    await act(async () => { finish('old-receipt'); });
    b.pop(1);
    act(() => auth.emit({ id: 'user', requiresEmailVerification: false }));
    expect(renderer!.root.findAllByType('textarea')).toHaveLength(0);
    expect(submitInquiry).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(renderer!.toJSON())).toContain('old-receipt');
  });

  it('drops a hidden owner draft and late receipt after logout, including same-owner login again', async () => {
    let finish!: (receipt: string) => void;
    vi.mocked(submitInquiry).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    auth = createFakeAuthSession(); vi.mocked(createAuthSessionService).mockReturnValue(auth.session);
    const b = browser(); mount(); click('/contact');
    act(() => auth.emit({ id: 'user', requiresEmailVerification: false }));
    act(() => renderer!.root.findByType('textarea').props.onChange({ target: { value: 'private draft' } }));
    act(() => renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
    click('/'); act(() => { auth.emit(null); auth.emit({ id: 'user', requiresEmailVerification: false }); });
    await act(async () => { finish('old-receipt'); }); b.pop(1);
    expect(renderer!.root.findByType('textarea').props.value).toBe('');
    expect(submitInquiry).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('old-receipt');
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('private draft');
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }])('preserves native anchor behavior for %j', event => {
    const b = browser(); mount();
    expect(click('/contact', event)).not.toHaveBeenCalled();
    expect(b.history.pushState).not.toHaveBeenCalled();
  });

  it.each([{ target: '_blank' }, { download: '' }, { href: '/admin' }, { href: 'https://example.test/contact' }])('does not intercept unsupported anchor props %j', props => {
    const b = browser();
    act(() => { renderer = create(<PublicPageBoundary><PublicPageLink href="/contact" {...props}>Link</PublicPageLink></PublicPageBoundary>); });
    const preventDefault = vi.fn();
    renderer!.root.findByType('a').props.onClick({ button: 0, preventDefault });
    expect(preventDefault).not.toHaveBeenCalled(); expect(b.history.pushState).not.toHaveBeenCalled();
  });

  it('retains ordinary anchors without a navigation owner and removes owned event listeners on unmount', () => {
    const b = browser();
    act(() => { renderer = create(<PublicPageLink href="/contact">Contact</PublicPageLink>); });
    expect(click('/contact')).not.toHaveBeenCalled();
    act(() => renderer!.unmount()); mount();
    act(() => renderer!.unmount()); renderer = undefined;
    expect([...b.events.values()].every(listeners => listeners.size === 0)).toBe(true);
  });
});
