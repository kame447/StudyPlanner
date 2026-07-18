import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { InitialWeekStartPreferenceScreen } from './InitialWeekStartPreferenceScreen';

function renderScreen() {
  const onSave = vi.fn(async () => true);
  const onRetry = vi.fn(async () => undefined);
  const onSignOut = vi.fn(async () => undefined);
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <InitialWeekStartPreferenceScreen
        error=""
        onSave={onSave}
        onRetry={onRetry}
        onSignOut={onSignOut}
      />,
    );
  });
  return { renderer, onSave };
}

describe('InitialWeekStartPreferenceScreen', () => {
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
