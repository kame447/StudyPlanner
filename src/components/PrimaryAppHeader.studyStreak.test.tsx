import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { PrimaryAppHeader } from './PrimaryAppHeader';
import { HomeTopbar } from './HomeTopbar';
import { event } from '../repositories/localPersistenceConcurrency.testUtils';
vi.mock('./HomeTopbar', () => ({ HomeTopbar: () => null }));

it('passes the original major-event source array to the header study qualification', () => {
  const monthEvents = [event({ id: 'job', title: '塾バイト' })];
  let renderer!: ReturnType<typeof create>;
  act(() => { renderer = create(<PrimaryAppHeader user={{ id: 'owner', username: 'User', email: '', avatar: '', createdAt: '' }}
    plans={[]} actuals={[]} monthEvents={monthEvents} todos={[]} onOpenProfile={vi.fn()} onOpenSettings={vi.fn()} />); });
  expect(renderer.root.findByType(HomeTopbar).props.monthEvents).toBe(monthEvents);
  act(() => renderer.unmount());
});
