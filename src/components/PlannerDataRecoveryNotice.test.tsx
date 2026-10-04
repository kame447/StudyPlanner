import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlannerDataRecovery } from '../domain/plannerDataReadAuthority';
import { useNoticeState } from '../hooks/useNoticeState';
import { PlannerDataRecoveryNotice } from './PlannerDataRecoveryNotice';

const failed: PlannerDataRecovery = {
  ownerId: 'user-a', reason: 'actual-material', phase: 'failed', canRetry: true,
};
let renderer: ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('PlannerDataRecoveryNotice', () => {
  it.each(['waiting', 'refreshing'] as const)('announces %s without offering retry', (phase) => {
    act(() => { renderer = create(<PlannerDataRecoveryNotice ownerId="user-a"
      recovery={{ ...failed, phase, canRetry: false }} onRetry={async () => undefined} />); });
    const status = renderer!.root.findByProps({ role: 'status' });
    expect(status.props['aria-live']).toBe('polite');
    expect(status.props['aria-atomic']).toBe('true');
    expect(JSON.stringify(status.children)).toContain('AIへの計画依頼');
    expect(renderer!.root.findAllByType('button')).toHaveLength(0);
  });

  it('offers a normal keyboard-accessible retry action for a failed read', async () => {
    const retry = vi.fn(async () => undefined);
    act(() => { renderer = create(<PlannerDataRecoveryNotice ownerId="user-a" recovery={failed} onRetry={retry} />); });
    const button = renderer!.root.findByType('button');
    expect(button.props.type).toBe('button');
    expect(button.children).toEqual(['表示の更新を再試行']);
    expect(JSON.stringify(renderer!.toJSON())).toContain('最新表示を確認できませんでした');
    await act(async () => { button.props.onClick(); });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('hides another owner synchronously and disappears when recovery clears', () => {
    const render = (ownerId: string | null, recovery: PlannerDataRecovery | null) => (
      <PlannerDataRecoveryNotice ownerId={ownerId} recovery={recovery} onRetry={async () => undefined} />
    );
    act(() => { renderer = create(render('user-a', failed)); });
    expect(renderer!.root.findAllByType('button')).toHaveLength(1);
    // No effect flush is needed to remove the old owner's notice.
    renderer!.update(render('user-b', failed));
    expect(renderer!.toJSON()).toBeNull();
    renderer!.update(render(null, failed));
    expect(renderer!.toJSON()).toBeNull();
    renderer!.update(render('user-a', null));
    expect(renderer!.toJSON()).toBeNull();
  });

  it('survives regular toast expiry, replacement, dismissal and surface remount', () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    let notices!: ReturnType<typeof useNoticeState>;
    function Harness({ surface }: { surface: string }) {
      notices = useNoticeState();
      return <main>{notices.notice ? <aside>{notices.notice.text}</aside> : null}
        <PlannerDataRecoveryNotice key={surface} ownerId="user-a" recovery={failed} onRetry={async () => undefined} />
      </main>;
    }
    act(() => { renderer = create(<Harness surface="home" />); });
    act(() => { notices.showNotice('保存しました', 'success'); });
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(notices.notice).toBeNull();
    expect(renderer!.root.findAllByType('button')).toHaveLength(1);
    act(() => { notices.showNotice('別の通知', 'error'); });
    act(() => { notices.dismissNotice(); renderer!.update(<Harness surface="ai-planning" />); });
    expect(renderer!.root.findAllByType('button')).toHaveLength(1);
    expect(renderer!.root.findAllByProps({ role: 'status' })).toHaveLength(1);
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('保存しました');
  });

  it.each(['full-read', 'full-read-and-actual-material'] as const)('describes %s as data recovery without claiming writes succeeded', (reason) => {
    act(() => { renderer = create(<PlannerDataRecoveryNotice ownerId="user-a"
      recovery={{ ...failed, reason }} onRetry={async () => undefined} />); });
    const text = JSON.stringify(renderer!.toJSON());
    expect(text).toContain('学習データの最新表示');
    expect(text).not.toContain('保存済み');
  });
});
