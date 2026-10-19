import { useLayoutEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthScreen } from './AuthScreen';

let renderer: ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });

function mount(overrides: Partial<Parameters<typeof AuthScreen>[0]> = {}) {
  const props = {
    notice: null,
    onDismissNotice: vi.fn(),
    onSignUpWithPassword: vi.fn().mockResolvedValue(false),
    onSignInWithPassword: vi.fn().mockResolvedValue(undefined),
    onSignInWithGoogle: vi.fn().mockResolvedValue(undefined),
    onSendPasswordReset: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  act(() => { renderer = create(<AuthScreen {...props} />); });
  return props;
}
const tab = (intent: 'sign-in' | 'sign-up') => renderer!.root.findByProps({ role: 'tab', 'data-intent': intent });
const input = (name: string) => renderer!.root.findByProps({ name });
const fill = (name: string, value: string) => act(() => input(name).props.onChange({ target: { value } }));
const select = (intent: 'sign-in' | 'sign-up') => act(() => tab(intent).props.onClick());
const submit = () => act(async () => { renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }); });

describe('login-first authentication presentation', () => {
  it('starts with login selected and no registration fields or input focus requests', () => {
    mount();
    expect(tab('sign-in').props).toMatchObject({ 'aria-selected': true, tabIndex: 0 });
    expect(tab('sign-up').props).toMatchObject({ 'aria-selected': false, tabIndex: -1 });
    expect(renderer!.root.findByType('form').props['aria-label']).toBe('ログイン');
    expect(renderer!.root.findByType('h1').children).toEqual(['ログイン']);
    expect(renderer!.root.findByType('section').props['aria-labelledby']).toBe(renderer!.root.findByType('h1').props.id);
    expect(renderer!.root.findAllByType('input').map(node => node.props.name)).toEqual(['email', 'password']);
    for (const node of renderer!.root.findAllByType('input')) expect(node.props.autoFocus).toBeUndefined();
    expect(input('email').props).toMatchObject({ autoComplete: 'email', autoCapitalize: 'none', spellCheck: false });
    expect(input('password').props.autoComplete).toBe('current-password');
    expect(renderer!.root.findAllByType('video')).toHaveLength(0);
  });

  it('submits the first form to sign-in without registering or modifying credentials', async () => {
    const props = mount();
    fill('email', 'login@example.test'); fill('password', 'existing-password');
    await submit();
    expect(props.onSignInWithPassword).toHaveBeenCalledExactlyOnceWith('login@example.test', 'existing-password');
    expect(props.onSignUpWithPassword).not.toHaveBeenCalled();
  });

  it('uses one named panel controlled by either tab', () => {
    mount();
    const panel = renderer!.root.findByProps({ role: 'tabpanel' });
    expect(tab('sign-in').props['aria-controls']).toBe(panel.props.id);
    expect(tab('sign-up').props['aria-controls']).toBe(panel.props.id);
    expect(panel.props['aria-labelledby']).toBe(tab('sign-in').props.id);
    select('sign-up');
    expect(panel.props['aria-labelledby']).toBe(tab('sign-up').props.id);
    expect(renderer!.root.findByType('h1').children).toEqual(['新規会員登録']);
    expect(input('password').props.autoComplete).toBe('new-password');
    expect(input('passwordConfirmation').props.autoComplete).toBe('new-password');
  });

  it.each([
    ['sign-in', 'ArrowRight', 'sign-up'], ['sign-up', 'ArrowLeft', 'sign-in'],
    ['sign-in', 'ArrowLeft', 'sign-up'], ['sign-up', 'ArrowRight', 'sign-in'],
    ['sign-up', 'Home', 'sign-in'], ['sign-in', 'End', 'sign-up'],
  ] as const)('moves the mode button focus from %s with %s to %s', (from, key, to) => {
    mount(); select(from);
    const focus = vi.fn(); const querySelector = vi.fn(() => ({ focus })); const preventDefault = vi.fn();
    act(() => tab(from).props.onKeyDown({ key, preventDefault, currentTarget: { parentElement: { querySelector } } }));
    expect(tab(to).props['aria-selected']).toBe(true);
    expect(querySelector).toHaveBeenCalledWith(`[data-intent="${to}"]`);
    expect(focus).toHaveBeenCalledOnce(); expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('leaves Tab to the browser rather than trapping focus in the mode control', () => {
    mount(); const preventDefault = vi.fn();
    act(() => tab('sign-in').props.onKeyDown({ key: 'Tab', preventDefault }));
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('rejects mismatched confirmation without calling the registration boundary', async () => {
    const props = mount(); select('sign-up');
    fill('password', 'abcdef12'); fill('passwordConfirmation', 'different12'); await submit();
    expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toContain('一致していません');
    expect(props.onSignUpWithPassword).not.toHaveBeenCalled();
  });

  it('preserves email but clears passwords and mismatch errors when switching modes', async () => {
    mount(); select('sign-up'); fill('email', 'kept@example.test');
    fill('password', 'abcdef12'); fill('passwordConfirmation', 'different12'); await submit();
    select('sign-in');
    expect(input('email').props.value).toBe('kept@example.test');
    expect(input('password').props.value).toBe('');
    expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
    select('sign-up'); expect(input('passwordConfirmation').props.value).toBe('');
  });

  it.each([false, true])('keeps the existing verification-mail result transition (registered=%s)', async registered => {
    const props = mount({ onSignUpWithPassword: vi.fn().mockResolvedValue(registered) });
    select('sign-up'); fill('username', 'Learner'); fill('email', 'new@example.test');
    fill('password', 'abcdef12'); fill('passwordConfirmation', 'abcdef12'); await submit();
    expect(props.onSignUpWithPassword).toHaveBeenCalledExactlyOnceWith('new@example.test', 'abcdef12', 'Learner');
    expect(tab(registered ? 'sign-in' : 'sign-up').props['aria-selected']).toBe(true);
    expect(input('email').props.value).toBe('new@example.test');
    expect(input('password').props.value).toBe(registered ? '' : 'abcdef12');
    expect(props.onSignInWithPassword).not.toHaveBeenCalled();
  });

  it('keeps password reset, Google sign-in and legal destinations reachable', async () => {
    const props = mount(); fill('email', 'reset@example.test');
    await act(async () => { renderer!.root.findByProps({ className: 'auth-entry-reset' }).props.onClick(); });
    await act(async () => { renderer!.root.findByProps({ className: 'auth-entry-google' }).props.onClick(); });
    expect(props.onSendPasswordReset).toHaveBeenCalledExactlyOnceWith('reset@example.test');
    expect(props.onSignInWithGoogle).toHaveBeenCalledOnce();
    expect(renderer!.root.findAllByType('a').map(node => node.props.href)).toEqual(['/terms', '/privacy']);
  });

  it('keeps actionable authentication notices and dismissal', async () => {
    const onAction = vi.fn(); const props = mount({ notice: { tone: 'info', text: '確認メールを送信しました', actionLabel: '再送信', onAction } });
    expect(renderer!.root.findByProps({ 'aria-live': 'polite' })).toBeDefined();
    await act(async () => { renderer!.root.findByProps({ className: 'app-toast-action' }).props.onClick(); });
    act(() => renderer!.root.findByProps({ 'aria-label': '通知を閉じる' }).props.onClick());
    expect(onAction).toHaveBeenCalledOnce(); expect(props.onDismissNotice).toHaveBeenCalledOnce();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('authentication entry pending admission', () => {
  it.each(['password', 'google', 'reset'] as const)('admits only one %s operation and blocks competing actions until completion', async kind => {
    const pending = deferred<void>();
    const props = mount({
      onSignInWithPassword: vi.fn(() => pending.promise),
      onSignInWithGoogle: vi.fn(() => pending.promise),
      onSendPasswordReset: vi.fn(() => pending.promise),
    });
    const form = renderer!.root.findByType('form').props.onSubmit;
    const google = renderer!.root.findByProps({ className: 'auth-entry-google' }).props.onClick;
    const reset = renderer!.root.findByProps({ className: 'auth-entry-reset' }).props.onClick;
    const start = kind === 'password' ? () => form({ preventDefault: vi.fn() }) : kind === 'google' ? google : reset;
    act(() => { start(); start(); form({ preventDefault: vi.fn() }); google(); reset(); });
    expect(props.onSignInWithPassword).toHaveBeenCalledTimes(kind === 'password' ? 1 : 0);
    expect(props.onSignInWithGoogle).toHaveBeenCalledTimes(kind === 'google' ? 1 : 0);
    expect(props.onSendPasswordReset).toHaveBeenCalledTimes(kind === 'reset' ? 1 : 0);
    expect(renderer!.root.findByType('form').props['aria-busy']).toBe(true);
    expect(tab('sign-up').props.disabled).toBe(true);
    for (const field of renderer!.root.findAllByType('input')) expect(field.props.disabled).toBe(true);
    await act(async () => pending.resolve());
    expect(renderer!.root.findByType('form').props['aria-busy']).toBe(false);
    await submit();
    expect(props.onSignInWithPassword).toHaveBeenCalledTimes(kind === 'password' ? 2 : 1);
  });

  it('keeps a pending registration in its submitted mode and admits it only once', async () => {
    const pending = deferred<boolean>();
    const props = mount({ onSignUpWithPassword: vi.fn(() => pending.promise) });
    select('sign-up'); fill('password', 'abcdef12'); fill('passwordConfirmation', 'abcdef12');
    const form = renderer!.root.findByType('form').props.onSubmit;
    act(() => { form({ preventDefault: vi.fn() }); form({ preventDefault: vi.fn() }); });
    select('sign-in');
    act(() => tab('sign-up').props.onKeyDown({ key: 'ArrowLeft', preventDefault: vi.fn() }));
    expect(tab('sign-up').props['aria-selected']).toBe(true);
    expect(props.onSignUpWithPassword).toHaveBeenCalledOnce();
    await act(async () => pending.resolve(false));
    expect(input('password').props.value).toBe('abcdef12');
    select('sign-in');
    expect(tab('sign-in').props['aria-selected']).toBe(true);
  });

  it('releases admission on rejection and shows an error without an unhandled rejection', async () => {
    const pending = deferred<void>();
    const props = mount({ onSignInWithPassword: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined) });
    await submit();
    await act(async () => pending.reject(new Error('synthetic failure')));
    expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toContain('もう一度');
    expect(renderer!.root.findByType('form').props['aria-busy']).toBe(false);
    await submit();
    expect(props.onSignInWithPassword).toHaveBeenCalledTimes(2);
    expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  });
});

describe('authentication entry lifetime', () => {
  it('ignores retained handlers after unmount, including after an old request settles', async () => {
    const pending = deferred<boolean>();
    const props = mount({ onSignUpWithPassword: vi.fn(() => pending.promise) });
    select('sign-up');
    const submitOld = renderer!.root.findByType('form').props.onSubmit;
    act(() => submitOld({ preventDefault: vi.fn() }));
    act(() => { renderer!.unmount(); renderer = undefined; });
    await act(async () => pending.resolve(true));
    act(() => submitOld({ preventDefault: vi.fn() }));
    expect(props.onSignUpWithPassword).toHaveBeenCalledOnce();
  });
});


it('retires retained auth handlers before replacement layout effects run', () => {
  const props = mount();
  const submitOld = renderer!.root.findByType('form').props.onSubmit;
  function Replacement() {
    useLayoutEffect(() => { submitOld({ preventDefault: vi.fn() }); }, []);
    return null;
  }
  act(() => renderer!.update(<Replacement />));
  expect(props.onSignInWithPassword).not.toHaveBeenCalled();
});
