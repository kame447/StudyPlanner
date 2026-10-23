import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { ActualTrackingTools } from './ActualTrackingTools';

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(['ストップウォッチ', 'タイマー'])('keeps %s apply behavior and unavailable-target feedback without permanent guidance', mode => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-14T10:00:00'));
  vi.stubGlobal('window', { setInterval, clearInterval });
  const onApplyMeasuredRange = vi.fn();
  const props = { onApplyMeasuredRange, canApplyMeasuredRange: false, applyDisabledReason: '反映先がありません' };
  act(() => { renderer = create(<ActualTrackingTools {...props} />); });
  const button = (text: string) => renderer!.root.findAllByType('button').find(node => node.children.includes(text))!;
  act(() => button(mode).props.onClick());
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('反映すると、');
  act(() => button('開始').props.onClick());
  act(() => { vi.advanceTimersByTime(60_000); });
  const apply = renderer!.root.findByProps({ title: '反映先がありません' });
  expect(apply.props.disabled).toBe(true);
  expect(onApplyMeasuredRange).not.toHaveBeenCalled();
  act(() => renderer!.update(<ActualTrackingTools {...props} canApplyMeasuredRange />));
  const availableApply = button('記録時刻へ反映');
  expect(availableApply.props.disabled).toBe(false);
  act(() => availableApply.props.onClick());
  expect(onApplyMeasuredRange).toHaveBeenCalledExactlyOnceWith('10:00', '10:01');
});
