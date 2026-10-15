import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { createPortal } from 'react-dom';
import { MonthEventColorPicker } from './MonthEventColorPicker';
import { MONTH_EVENT_COLOR_OPTIONS } from '../lib/scheduleEventColor';

vi.mock('react-dom', () => ({ createPortal: vi.fn((node: unknown) => node) }));

function mount(color?: (typeof MONTH_EVENT_COLOR_OPTIONS)[number]['key'], disabled = false) {
  const onChange = vi.fn();
  const nativeDialog = { open: false, showModal: vi.fn(), close: vi.fn() };
  nativeDialog.showModal.mockImplementation(() => { nativeDialog.open = true; });
  nativeDialog.close.mockImplementation(() => { nativeDialog.open = false; });
  const selectedRadio = { focus: vi.fn() };
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<MonthEventColorPicker color={color} automaticColor="#72aefa" disabled={disabled} onChange={onChange} />, {
    createNodeMock: element => element.type === 'dialog' ? nativeDialog : element.type === 'input' ? selectedRadio : null,
  }); });
  const trigger = () => renderer.root.findByProps({ className: 'month-event-color-trigger' });
  return { renderer, trigger, onChange, nativeDialog, selectedRadio };
}

describe('compact event label picker', () => {
  it.each([undefined, ...MONTH_EVENT_COLOR_OPTIONS.map(option => option.key)])('displays and focuses the saved %s choice without changing it on open', color => {
    const { renderer, trigger, onChange, nativeDialog, selectedRadio } = mount(color);
    try {
      const expected = MONTH_EVENT_COLOR_OPTIONS.find(option => option.key === color);
      expect(trigger().findAllByProps({ className: 'month-event-color-dot' })[0].props.style.backgroundColor).toBe(expected?.color ?? '#72aefa');
      act(() => trigger().props.onClick());
      expect(nativeDialog.showModal).toHaveBeenCalledTimes(1);
      expect(selectedRadio.focus).toHaveBeenCalledTimes(1);
      const checked = renderer.root.findAllByProps({ type: 'radio' }).filter(input => input.props.checked);
      expect(checked).toHaveLength(1);
      expect(checked[0].props['aria-label']).toBe(expected?.label ?? '自動');
      expect(onChange).not.toHaveBeenCalled();
      act(() => renderer.root.findByProps({ 'aria-label': '青' }).props.onChange());
      expect(onChange).toHaveBeenCalledWith('blue');
    } finally { act(() => renderer.unmount()); }
    expect(nativeDialog.close).toHaveBeenCalledTimes(1);
  });

  it.each(['done', 'escape', 'backdrop'] as const)('dismisses with %s without selecting or submitting', dismiss => {
    const { renderer, trigger, onChange, nativeDialog } = mount('pink');
    const dismissBeforeCommit = (action: () => void) => act(() => {
      action();
      // React flushes the removal after this event callback. Native close must precede it.
      expect(nativeDialog.close).toHaveBeenCalledTimes(1);
    });
    try {
      act(() => trigger().props.onClick());
      const dialog = renderer.root.findByType('dialog');
      if (dismiss === 'done') {
        dismissBeforeCommit(() => dialog.findByType('button').props.onClick());
      } else if (dismiss === 'escape') {
        const preventDefault = vi.fn();
        dismissBeforeCommit(() => dialog.props.onCancel({ preventDefault }));
        expect(preventDefault).toHaveBeenCalledTimes(1);
      } else {
        act(() => dialog.props.onClick({ target: 'content', currentTarget: 'dialog' }));
        expect(trigger().props['aria-expanded']).toBe(true);
        dismissBeforeCommit(() => dialog.props.onClick({ target: 'dialog', currentTarget: 'dialog' }));
      }
      expect(trigger().props['aria-expanded']).toBe(false);
      expect(renderer.root.findAllByType('dialog')).toHaveLength(0);
      expect(nativeDialog.close).toHaveBeenCalledTimes(1);
      expect(onChange).not.toHaveBeenCalled();
    } finally { act(() => renderer.unmount()); }
  });

  it('does not open or change a disabled field', () => {
    const { renderer, trigger, onChange, nativeDialog } = mount('pink', true);
    try {
      expect(trigger().props.disabled).toBe(true);
      act(() => trigger().props.onClick());
      expect(trigger().props['aria-expanded']).toBe(false);
      expect(nativeDialog.showModal).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    } finally { act(() => renderer.unmount()); }
  });
});


it('portals the native dialog outside the editor DOM used by parent drag dismissal', () => {
  const body = {};
  vi.stubGlobal('document', { body });
  const { renderer, trigger } = mount('blue');
  try {
    act(() => trigger().props.onClick());
    const calls = vi.mocked(createPortal).mock.calls;
    expect(calls[calls.length - 1]?.[1]).toBe(body);
    expect(renderer.root.findByType('dialog').props.className).toBe('month-event-color-dialog');
  } finally { act(() => renderer.unmount()); vi.unstubAllGlobals(); }
});
