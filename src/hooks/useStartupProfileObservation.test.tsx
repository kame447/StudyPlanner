import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStartupProfileObservation } from './useStartupProfileObservation';
import { createStartupSessionScope } from '../lib/startupSessionScope';
const fixture = vi.hoisted(() => ({ observe: vi.fn() }));
vi.mock('../repositories', () => ({ authRepository: { observeStartupProfile: fixture.observe } }));
vi.mock('../lib/startupProfileObservation', () => ({ startupProfileObservation: 'off' }));
type Input = Parameters<typeof useStartupProfileObservation>[0];
let renderer: ReactTestRenderer | undefined;
let finish: () => void;
let stops: ReturnType<typeof vi.fn>[];
function Probe(props: Input) { finish = useStartupProfileObservation(props); return null; }
function render(props: Input) { act(() => { if (renderer) renderer.update(<Probe {...props} />); else renderer = create(<Probe {...props} />); }); }
const input = (): Input => ({ ownerId: 'a', scope: createStartupSessionScope(), preferenceStatus: 'loading', enabled: true });
beforeEach(() => {
  stops = []; fixture.observe.mockReset();
  fixture.observe.mockImplementation((_owner, scope) => {
    let closed = false;
    const disposed = vi.fn(); stops.push(disposed);
    const stop = () => { if (!closed) { closed = true; disposed(); } };
    scope.onInvalidate(stop); return stop;
  });
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });
it('observes only during initial loading and remains alive until Home completion', () => {
  const props = input(); render(props); expect(fixture.observe).toHaveBeenCalledOnce();
  render({ ...props, preferenceStatus: 'ready' }); expect(stops[0]).not.toHaveBeenCalled();
  act(() => finish()); expect(stops[0]).toHaveBeenCalledOnce();
  render(props); expect(fixture.observe).toHaveBeenCalledOnce();
});
it('permanently closes on a blocked preference result, including subsequent retry', () => {
  const props = input(); render(props);
  render({ ...props, preferenceStatus: 'blocked' }); expect(stops[0]).toHaveBeenCalledOnce();
  render(props); render({ ...props, preferenceStatus: 'ready' });
  expect(fixture.observe).toHaveBeenCalledOnce();
});
it('an old finish callback cannot dispose the new owner or same-owner session', () => {
  const props = input(); render(props); const first = finish;
  const next = input(); render(next); expect(stops[0]).toHaveBeenCalledOnce();
  act(() => first()); expect(stops[1]).not.toHaveBeenCalled();
  render({ ...input(), ownerId: 'b' }); expect(stops[1]).toHaveBeenCalledOnce();
  act(() => finish()); expect(stops[2]).toHaveBeenCalledOnce();
});
it('revokes immediately outside React and disposes on unmount', () => {
  const scope = createStartupSessionScope(); render({ ...input(), scope });
  scope.invalidate(); expect(stops[0]).toHaveBeenCalledOnce();
  render(input()); act(() => renderer!.unmount()); renderer = undefined;
  expect(stops[1]).toHaveBeenCalledOnce();
});
it('defaults OFF, skips already ready or revoked scopes, and tolerates an unsupported port', () => {
  const { enabled: _enabled, ...props } = input(); render(props);
  expect(fixture.observe).not.toHaveBeenCalled();
  render({ ...input(), preferenceStatus: 'ready' }); expect(fixture.observe).not.toHaveBeenCalled();
  const scope = createStartupSessionScope(); scope.invalidate(); render({ ...input(), scope });
  expect(fixture.observe).not.toHaveBeenCalled();
  fixture.observe.mockReturnValue(undefined); render(input()); act(() => finish());
});
it('an optional observer failure cannot fail normal startup or cause repeated starts', () => {
  fixture.observe.mockImplementation(() => { throw new Error('observer unavailable'); });
  const props = input(); expect(() => render(props)).not.toThrow();
  render({ ...props, preferenceStatus: 'ready' }); render(props);
  expect(fixture.observe).toHaveBeenCalledOnce();
});
