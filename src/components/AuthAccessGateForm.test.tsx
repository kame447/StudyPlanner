import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { AuthAccessGateForm } from './AuthAccessGateForm';

describe('AuthAccessGateForm', () => {
  it('keeps access-gate validation local to the gate flow', () => {
    const onUnlock = vi.fn((key: string) => key === 'correct-key');
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(<AuthAccessGateForm onUnlock={onUnlock} />);
    });

    act(() => {
      renderer.root.findByType('input').props.onChange({
        target: { value: 'wrong-key' },
      });
    });
    act(() => {
      renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
    });

    expect(onUnlock).toHaveBeenCalledWith('wrong-key');
    expect(renderer.root.findAllByProps({ className: 'inline-error' })[0]?.children).toContain(
      '閲覧キーが一致しません。',
    );

    act(() => {
      renderer.root.findByType('input').props.onChange({
        target: { value: 'correct-key' },
      });
    });
    act(() => {
      renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
    });

    expect(onUnlock).toHaveBeenCalledWith('correct-key');
    expect(renderer.root.findAllByProps({ className: 'inline-error' })).toHaveLength(0);
  });
});
