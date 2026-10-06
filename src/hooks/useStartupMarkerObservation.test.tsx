import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStartupMarkerObservation } from './useStartupMarkerObservation';
import { createStartupSessionScope } from '../lib/startupSessionScope';
import { createFakeAuthSession } from '../test/fakeAuthSession';
const fixture = vi.hoisted(() => ({ mode: 'off', observe: vi.fn() }));
vi.mock('../repositories', () => ({ plannerRepository: { observeStartupScheduleMarker: fixture.observe } }));
vi.mock('../lib/startupMarkerObservation', () => ({ get startupMarkerObservation() { return fixture.mode; } }));
let renderer: ReactTestRenderer | undefined;
let finish: () => void;
function Probe(props: Parameters<typeof useStartupMarkerObservation>[0]) { finish = useStartupMarkerObservation(props); return null; }
beforeEach(() => { fixture.mode = 'observe'; fixture.observe.mockReset().mockReturnValue(vi.fn()); });
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });
it.each(['none', 'wrong-owner', 'unverified', 'throw'])('does not observe without a current verified owner: %s', kind => {
  const fake = createFakeAuthSession({ currentUser: kind === 'none' ? null : { id: kind === 'wrong-owner' ? 'b' : 'a', requiresEmailVerification: kind === 'unverified' } });
  if (kind === 'throw') fake.session.getCurrentUser = () => { throw new Error('session unavailable'); };
  act(() => { renderer = create(<Probe ownerId="a" scope={createStartupSessionScope()} authSession={fake.session} />); });
  expect(fixture.observe).not.toHaveBeenCalled();
});
it('passes live eligibility, closes once at settlement, and cannot restart on rerender', () => {
  const fake = createFakeAuthSession({ currentUser: { id: 'a', requiresEmailVerification: false } });
  const scope = createStartupSessionScope(); const props = { ownerId: 'a', scope, authSession: fake.session };
  const stop = vi.fn(); fixture.observe.mockReturnValue(stop);
  act(() => { renderer = create(<Probe {...props} />); });
  const eligible = fixture.observe.mock.calls[0][1]; expect(eligible.isCurrent()).toBe(true);
  fake.emit({ id: 'b', requiresEmailVerification: false }); expect(eligible.isCurrent()).toBe(false);
  fake.emit({ id: 'a', requiresEmailVerification: false }); scope.invalidate(); expect(eligible.isCurrent()).toBe(false);
  act(() => finish()); act(() => renderer!.update(<Probe {...props} />));
  expect(stop).toHaveBeenCalledOnce(); expect(fixture.observe).toHaveBeenCalledOnce();
});
it('is inert by default and in standalone callers lacking a root scope', () => {
  const fake = createFakeAuthSession({ currentUser: { id: 'a', requiresEmailVerification: false } });
  fixture.mode = 'off';
  act(() => { renderer = create(<Probe ownerId="a" scope={createStartupSessionScope()} authSession={fake.session} />); });
  expect(fixture.observe).not.toHaveBeenCalled();
  fixture.mode = 'observe'; act(() => renderer!.update(<Probe ownerId="a" authSession={fake.session} />));
  expect(fixture.observe).not.toHaveBeenCalled();
});
