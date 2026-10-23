import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHomeDashboardModel } from '../../lib/homeDashboard';
import { setMotionPreference } from '../../lib/motionPreference';
import { installFakeMotionEnvironment } from '../../lib/motionPreference.testUtils';
import type { Actual } from '../../types/domain';
import { HomeScene } from './HomeScene';

let env: ReturnType<typeof installFakeMotionEnvironment>;
let renderer: ReactTestRenderer | undefined;
const hops: Array<{ cancel: ReturnType<typeof vi.fn> }> = [];
const companion = {
  animate: () => {
    const animation = { cancel: vi.fn(), addEventListener: vi.fn() };
    hops.push(animation);
    return animation;
  },
};

type SceneProps = Parameters<typeof HomeScene>[0];
function show(minutes: number, { week = '2026-10-12', ...props }: Partial<SceneProps> & { week?: string } = {}) {
  act(() => {
    const element = <HomeScene kind="study" preferences={{ style: 'pixel-cat', animated: true }}
      recorded={{ week, minutes }} {...props} />;
    if (renderer) renderer.update(element);
    else renderer = create(element, {
      createNodeMock: node => (String(node.props.className ?? '').startsWith('home-') ? { querySelector: () => companion } : {}),
    });
  });
}

beforeEach(() => {
  env = installFakeMotionEnvironment();
  vi.stubGlobal('document', { documentElement: { dataset: {} }, visibilityState: 'visible',
    addEventListener: vi.fn(), removeEventListener: vi.fn() });
  hops.length = 0;
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; env.restore(); });

describe('companion reaction', () => {
  it('stays still on first paint and hops once when more study is saved', () => {
    show(60);
    expect(hops).toHaveLength(0);
    show(80);
    expect(hops).toHaveLength(1);
    show(80);
    show(20);
    expect(hops).toHaveLength(1);
  });

  it('never hops on a clock tick: the saved weekly total does not depend on the time', () => {
    const actuals = [{ id: 'saved', userId: 'u', planId: null, occurrenceDate: '2026-10-16', actualStartTime: '12:00', actualEndTime: '13:00',
      title: '記録済み', subject: '数学', isAlignedToPlan: false, note: '', updatedAt: '2026-10-16T12:00:00' }] as unknown as Actual[];
    const at = (time: string) => buildHomeDashboardModel({ plans: [], actuals, todos: [], now: new Date(`2026-10-16T${time}:00`) });
    const [before, after] = [at('12:05'), at('12:06')];
    expect([before.weekActualMinutesByNow, after.weekActualMinutesByNow]).toEqual([5, 6]);
    show(before.weekActualMinutes);
    show(after.weekActualMinutes);
    expect(hops).toHaveLength(0);
  });

  it('does not count a new week as an increase', () => {
    show(0, { week: '2026-10-12' });
    show(30, { week: '2026-10-19' });
    expect(hops).toHaveLength(0);
  });

  it('stops a running hop when the illustration motion is turned off, and when the app level drops', () => {
    show(0);
    show(10);
    show(10, { preferences: { style: 'pixel-cat', animated: false } });
    expect(hops[0].cancel).toHaveBeenCalledTimes(1);

    show(10, { preferences: { style: 'pixel-cat', animated: true } });
    show(20);
    setMotionPreference('off');
    expect(hops[1].cancel).toHaveBeenCalledTimes(1);
  });

  it('stays still on a hidden page and in the settings preview', () => {
    show(0);
    (document as unknown as { visibilityState: string }).visibilityState = 'hidden';
    show(10);
    (document as unknown as { visibilityState: string }).visibilityState = 'visible';
    show(20, { preview: true });
    expect(hops).toHaveLength(0);
  });
});
