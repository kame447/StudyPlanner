import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { InitialPrivacyConsentScreen } from './InitialPrivacyConsentScreen';

function renderScreen(overrides: Partial<Parameters<typeof InitialPrivacyConsentScreen>[0]> = {}) {
  const onAccept = vi.fn(async () => true);
  const onRetry = vi.fn(async () => undefined);
  const onSignOut = vi.fn(async () => undefined);
  let renderer!: ReactTestRenderer;

  act(() => {
    renderer = create(
      <InitialPrivacyConsentScreen
        unavailable={false}
        error=""
        onAccept={onAccept}
        onRetry={onRetry}
        onSignOut={onSignOut}
        {...overrides}
      />,
    );
  });

  return { renderer, onAccept, onRetry, onSignOut };
}

describe('InitialPrivacyConsentScreen', () => {
  it('requires explicit confirmation before saving account consent', async () => {
    const { renderer, onAccept } = renderScreen();
    const acceptButton = renderer.root.findAllByType('button').find(
      (button) => button.children.join('') === '同意して利用を開始する',
    );
    expect(acceptButton?.props.disabled).toBe(true);

    const checkbox = renderer.root.findByType('input');
    act(() => checkbox.props.onChange({ target: { checked: true } }));

    const enabledButton = renderer.root.findAllByType('button').find(
      (button) => button.children.join('') === '同意して利用を開始する',
    );
    expect(enabledButton?.props.disabled).toBe(false);

    await act(async () => {
      enabledButton?.props.onClick();
      await Promise.resolve();
    });
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('offers retry and sign-out when the account consent status is unavailable', () => {
    const { renderer, onRetry, onSignOut } = renderScreen({
      unavailable: true,
      error: '通信に失敗しました。',
    });
    const buttons = renderer.root.findAllByType('button');
    const retry = buttons.find((button) => button.children.join('') === 'もう一度確認する');
    const signOut = buttons.find((button) => button.children.join('') === 'ログアウトする');

    act(() => retry?.props.onClick());
    act(() => signOut?.props.onClick());

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
