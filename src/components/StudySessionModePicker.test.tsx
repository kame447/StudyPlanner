import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { StudySessionModePicker } from './StudySessionModePicker';
let renderer: ReactTestRenderer | undefined;
afterEach(() => act(() => renderer?.unmount()));

function mount(disabled = false) {
  const onChange = vi.fn();
  act(() => { renderer = create(<StudySessionModePicker value="normal" disabled={disabled} onChange={onChange} />); });
  return { onChange, buttons: renderer!.root.findAllByType('button') };
}
function pointer(x: number, y = 0) {
  return { isPrimary: true, button: 0, pointerId: 1, clientX: x, clientY: y, currentTarget: { setPointerCapture: vi.fn() } };
}

it('exposes selected mode and moves the indicator without replacing its element', () => {
  const { buttons, onChange } = mount();
  const indicator = renderer!.root.findByProps({ className: 'study-session-mode-indicator' });
  act(() => buttons[1].props.onClick());
  expect(onChange).toHaveBeenCalledWith('pomodoro');
  act(() => renderer!.update(<StudySessionModePicker value="pomodoro" disabled={false} onChange={onChange} />));
  expect(renderer!.root.findByProps({ role: 'group' }).props['data-mode']).toBe('pomodoro');
  expect(buttons[1].props['aria-pressed']).toBe(true);
  expect(renderer!.root.findByProps({ className: 'study-session-mode-indicator' })).toBe(indicator);
});

it('switches once after a horizontal pointer swipe and suppresses its generated click', () => {
  const { buttons, onChange } = mount();
  act(() => {
    buttons[0].props.onPointerDown(pointer(150));
    buttons[0].props.onPointerUp(pointer(70, 5));
    buttons[0].props.onClick();
  });
  expect(onChange.mock.calls).toEqual([['pomodoro']]);
  act(() => buttons[0].props.onClick());
  expect(onChange).toHaveBeenLastCalledWith('normal');
});

it.each(['vertical', 'cancelled', 'short', 'multiple'] as const)('does not select during a %s gesture', kind => {
  const { buttons, onChange } = mount();
  act(() => {
    buttons[0].props.onPointerDown(pointer(150));
    if (kind === 'cancelled') buttons[0].props.onPointerCancel();
    if (kind === 'multiple') buttons[0].props.onPointerDown({ ...pointer(150), isPrimary: false });
    buttons[0].props.onPointerUp(kind === 'vertical' ? pointer(100, 110) : kind === 'short' ? pointer(130) : pointer(70));
  });
  expect(onChange).not.toHaveBeenCalled();
});

it('supports directional keyboard selection and transfers focus to the selected button', () => {
  const { buttons, onChange } = mount();
  const focus = vi.fn(), preventDefault = vi.fn(), querySelector = vi.fn(() => ({ focus }));
  act(() => buttons[0].props.onKeyDown({ key: 'ArrowRight', preventDefault, currentTarget: { parentElement: { querySelector } } }));
  expect(onChange).toHaveBeenCalledWith('pomodoro');
  expect(querySelector).toHaveBeenCalledWith('[data-mode="pomodoro"]');
  expect(focus).toHaveBeenCalledOnce();
  expect(preventDefault).toHaveBeenCalledOnce();
});

it('locks click, swipe and keyboard changes after timer start', () => {
  const { buttons, onChange } = mount(true);
  act(() => {
    buttons[1].props.onClick();
    buttons[0].props.onPointerDown(pointer(150));
    buttons[0].props.onPointerUp(pointer(70));
    buttons[0].props.onKeyDown({ key: 'ArrowRight' });
  });
  expect(onChange).not.toHaveBeenCalled();
});
