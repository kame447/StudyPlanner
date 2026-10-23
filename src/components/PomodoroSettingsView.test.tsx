import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { PomodoroSettingsView } from './PomodoroSettingsView';
import { FaqView } from './FaqView';

describe('Pomodoro custom settings', () => {
  function setup() {
    const onSave = vi.fn();
    let view!: ReactTestRenderer;
    act(() => { view = create(<PomodoroSettingsView initialSettings={{ preset: '25-5', setCount: null }} planned={false} onSave={onSave} />); });
    const choose = (label: string) => act(() => { view.root.findAllByType('button').find(button => button.children.includes(label))!.props.onClick(); });
    const input = (label: string, value: string) => act(() => { view.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value } }); });
    return { view, onSave, choose, input };
  }

  it('retains both presets, saves custom times and preserves values when toggling', () => {
    const { view, onSave, choose, input } = setup();
    expect(view.root.findAllByType('button').map(button => button.children.join(''))).toEqual(['25分 / 5分', '50分 / 10分', 'カスタム', '設定を保存']);
    choose('カスタム');
    input('集中（分）', '17'); input('休憩（分）', '3');
    choose('50分 / 10分'); choose('カスタム');
    expect(view.root.findByProps({ 'aria-label': '集中（分）' }).props.value).toBe('17');
    act(() => { view.root.findByType('select').props.onChange({ target: { value: '2' } }); });
    choose('設定を保存');
    expect(onSave).toHaveBeenCalledWith({ preset: 'custom', setCount: 2, customFocusMinutes: 17, customBreakMinutes: 3 });
  });

  it.each(['', '0', '-1', '1.5', '1441', 'Infinity', 'NaN'])('blocks invalid custom input %s without clamping user input', value => {
    const { view, onSave, choose, input } = setup();
    choose('カスタム'); input('休憩（分）', value);
    expect(view.root.findByProps({ 'aria-label': '休憩（分）' }).props.value).toBe(value);
    expect(view.root.findByProps({ className: 'study-session-save-button' }).props.disabled).toBe(true);
    choose('設定を保存'); expect(onSave).not.toHaveBeenCalled();
    choose('25分 / 5分'); choose('設定を保存');
    expect(onSave).toHaveBeenCalledWith({ preset: '25-5', setCount: null });
  });

  it('keeps explanatory prose in FAQ rather than the settings screen', () => {
    const { view } = setup();
    expect(JSON.stringify(view.toJSON())).not.toContain('休憩を含めて記録');
    let faq!: ReactTestRenderer;
    act(() => { faq = create(<FaqView />); });
    expect(JSON.stringify(faq.toJSON())).toContain('休憩を含めて記録');
  });
});
