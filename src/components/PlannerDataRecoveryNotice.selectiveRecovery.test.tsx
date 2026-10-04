import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlannerDataRecovery } from '../domain/plannerDataReadAuthority';
import { PlannerDataRecoveryNotice } from './PlannerDataRecoveryNotice';

let renderer: ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });
const reasons = [
  ['month-events', '月の主要予定'],
  ['projections', '学習データ'],
  ['full-read-and-projections', '学習データ'],
] as const;
const phases = [
  ['waiting', 'の最新表示を確認するまでお待ちください。'],
  ['refreshing', 'の表示を更新しています。'],
  ['failed', 'の最新表示を確認できませんでした。'],
] as const;

describe('selective repair notice subjects', () => {
  for (const [phase, description] of phases) {
    it.each(reasons)(`describes %s with the right subject while ${phase}`, async (reason, subject) => {
      const onRetry = vi.fn(async () => undefined);
      const recovery: PlannerDataRecovery = { ownerId: 'owner', reason, phase, canRetry: phase === 'failed' };
      act(() => {
        renderer = create(<PlannerDataRecoveryNotice ownerId="owner" recovery={recovery} onRetry={onRetry} />);
      });
      const status = renderer!.root.findByProps({ role: 'status' });
      const text = status.children.join('');
      expect(text).toContain(`${subject}${description}`);
      expect(text).toContain('AIへの計画依頼は、確認が完了してから送信できます。');
      expect(text).not.toContain('実績・教材');
      expect(text).not.toContain('保存済み');
      expect(status.props['aria-live']).toBe('polite');
      expect(status.props['aria-atomic']).toBe('true');
      const buttons = renderer!.root.findAllByType('button');
      expect(buttons).toHaveLength(phase === 'failed' ? 1 : 0);
      if (phase === 'failed') {
        expect(buttons[0].children).toEqual(['表示の更新を再試行']);
        await act(async () => { buttons[0].props.onClick(); });
        expect(onRetry).toHaveBeenCalledTimes(1);
      }
    });
  }

  it('hides a previous owner’s MonthEvent recovery and clears the current notice after repair', () => {
    const recovery: PlannerDataRecovery = { ownerId: 'owner', reason: 'month-events', phase: 'failed', canRetry: true };
    const onRetry = vi.fn(async () => undefined);
    act(() => { renderer = create(<PlannerDataRecoveryNotice ownerId="owner" recovery={recovery} onRetry={onRetry} />); });
    expect(renderer!.root.findAllByProps({ role: 'status' })).toHaveLength(1);
    act(() => { renderer!.update(<PlannerDataRecoveryNotice ownerId="other" recovery={recovery} onRetry={onRetry} />); });
    expect(renderer!.toJSON()).toBeNull();
    act(() => { renderer!.update(<PlannerDataRecoveryNotice ownerId="owner" recovery={null} onRetry={onRetry} />); });
    expect(renderer!.toJSON()).toBeNull();
    expect(onRetry).not.toHaveBeenCalled();
  });
});
