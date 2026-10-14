import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { InitialWeekStartPreferenceScreen } from './InitialWeekStartPreferenceScreen';

function renderScreen(readFailed = false) {
  const onSave = vi.fn(async () => true);
  const onRetry = vi.fn(async () => undefined);
  const onSignOut = vi.fn(async () => undefined);
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <InitialWeekStartPreferenceScreen
        error={readFailed ? "settings unavailable" : ""}
        readFailed={readFailed}
        onSave={onSave}
        onRetry={onRetry}
        onSignOut={onSignOut}
      />,
    );
  });
  return { renderer, onSave, onRetry, onSignOut };
}

describe('InitialWeekStartPreferenceScreen', () => {
  it('blocks settings writes after a read failure while retry and sign-out stay available', async () => {
    const { renderer, onSave, onRetry, onSignOut } = renderScreen(true);
    expect(renderer.root.findByType('h2').children.join('')).toBe('学習設定を読み込めませんでした');
    const select = renderer.root.findByType('select');
    expect(select.props.disabled).toBe(true);
    const buttons = renderer.root.findAllByType('button');
    const save = buttons.find(button => button.children.join('') === 'この設定で始める')!;
    expect(save.props.disabled).toBe(true);
    await act(async () => {
      select.props.onChange({ target: { value: 'sunday' } });
      save.props.onClick();
      await Promise.resolve();
    });
    expect(onSave).not.toHaveBeenCalled();
    const retry = buttons.find(button => button.children.join('') === 'もう一度読み込む')!;
    const signOut = buttons.find(button => button.children.join('') === 'ログアウトする')!;
    expect(retry.props.disabled).toBe(false);
    expect(signOut.props.disabled).toBe(false);
    await act(async () => { retry.props.onClick(); signOut.props.onClick(); await Promise.resolve(); });
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onSignOut).toHaveBeenCalledOnce();
    act(() => renderer.unmount());
  });

  it('stores the explicitly selected week start', async () => {
    const { renderer, onSave } = renderScreen();
    const select = renderer.root.findByType('select');
    act(() => select.props.onChange({ target: { value: 'sunday' } }));

    const saveButton = renderer.root.findAllByType('button').find(
      (button) => button.children.join('') === 'この設定で始める',
    );
    await act(async () => {
      saveButton?.props.onClick();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledWith('sunday');
  });
});
