import { StrictMode } from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { useOptimisticPlannerState } from './useOptimisticPlannerState';
import { usePlannerMutationScope } from './usePlannerMutationScope';

type Item = { id: string; title: string };
const initial: Item[] = [{ id: 'a', title: 'original' }, { id: 'b', title: 'other' }];
type Result = ReturnType<typeof useOptimisticPlannerState<Item[]>>;
let latest: Result;
let invalidate: () => void;
function Harness({ owner = 'owner-a' }: { owner?: string }) {
  const context = usePlannerMutationScope(owner);
  invalidate = context.invalidate;
  latest = useOptimisticPlannerState(initial, context.scope);
  return null;
}
const put = (title: string, id = 'a') => (items: Item[]) => [
  ...items.filter(item => item.id !== id), { id, title },
];
const remove = (items: Item[]) => items.filter(item => item.id !== 'a');
const read = () => latest.value.find(item => item.id === 'a')?.title;

describe('optimistic planner UI projection', () => {
  for (const order of ['first-then-second', 'second-then-first'] as const) {
    for (const firstResult of ['commit', 'reject'] as const) {
      for (const secondResult of ['commit', 'reject'] as const) {
        it(`settles two same-item updates: ${order} / ${firstResult} / ${secondResult}`, () => {
          const renderer = create(<StrictMode><Harness /></StrictMode>);
          let first!: symbol;
          let second!: symbol;
          act(() => {
            first = latest.begin(put('first'));
            second = latest.begin(put('second'));
          });
          expect(read()).toBe('second');
          if (order === 'first-then-second') {
            act(() => { latest[firstResult](first); });
            expect(read()).toBe('second');
            act(() => { latest[secondResult](second); });
          } else {
            act(() => { latest[secondResult](second); });
            expect(read()).toBe(secondResult === 'commit' ? 'second' : 'first');
            act(() => { latest[firstResult](first); });
          }
          expect(read()).toBe(secondResult === 'commit'
            ? 'second' : firstResult === 'commit' ? 'first' : 'original');
          expect(latest.value.find(item => item.id === 'b')?.title).toBe('other');
          renderer.unmount();
        });
      }
    }
  }

  it('rejects delete then update without reviving a failed optimistic value', () => {
    const renderer = create(<Harness />);
    let deletion!: symbol;
    let update!: symbol;
    act(() => { deletion = latest.begin(remove); });
    expect(read()).toBeUndefined();
    act(() => { update = latest.begin(put('new')); });
    act(() => { latest.reject(deletion); });
    expect(read()).toBe('new');
    act(() => { latest.reject(update); });
    expect(read()).toBe('original');
    renderer.unmount();
  });

  it('retains an acknowledged unrelated update after pending rejection', () => {
    const renderer = create(<Harness />);
    let pending!: symbol;
    act(() => { pending = latest.begin(put('pending')); });
    act(() => { latest.set(put('saved', 'b')); });
    act(() => { latest.reject(pending); });
    expect(read()).toBe('original');
    expect(latest.value.find(item => item.id === 'b')?.title).toBe('saved');
    renderer.unmount();
  });

  it.each(['commit', 'reject'] as const)('ignores late %s after authoritative refresh', outcome => {
    const renderer = create(<Harness />);
    let pending!: symbol;
    act(() => { pending = latest.begin(put('pending')); });
    act(() => { latest.replace([{ id: 'a', title: 'server' }]); });
    act(() => { latest[outcome](pending); });
    expect(read()).toBe('server');
    renderer.unmount();
  });

  it.each(['owner', 'reset', 'unmount'] as const)('blocks old operations after %s', boundary => {
    const renderer = create(<Harness />);
    let pending!: symbol;
    act(() => { pending = latest.begin(put('pending')); });
    const old = latest;
    act(() => {
      if (boundary === 'owner') renderer.update(<Harness owner="owner-b" />);
      else if (boundary === 'reset') invalidate();
      else renderer.unmount();
    });
    if (boundary !== 'unmount') act(() => { latest.replace([{ id: 'a', title: 'new owner' }]); });
    const snapshot = latest.value;
    act(() => { old.reject(pending); old.set(put('stale')); old.begin(put('stale pending')); });
    expect(latest.value).toBe(snapshot);
    if (boundary !== 'unmount') renderer.unmount();
  });
  it.each(['owner', 'reset'] as const)('blocks old rejection during %s before a new load arrives', boundary => {
    const renderer = create(<Harness />);
    let pending!: symbol;
    act(() => { pending = latest.begin(put('pending')); });
    const old = latest;
    act(() => {
      if (boundary === 'owner') renderer.update(<Harness owner="owner-b" />);
      else invalidate();
    });
    expect(read()).toBe('pending');
    act(() => { old.reject(pending); });
    // This hook does not own when the screen clears; it must not let an old
    // callback alter state while the authoritative owner load is still pending.
    expect(read()).toBe('pending');
    renderer.unmount();
  });

  it('keeps projection identity stable across unrelated renders while pending', () => {
    const renderer = create(<Harness />);
    act(() => { latest.begin(put('pending')); });
    const snapshot = latest.value;
    act(() => { renderer.update(<Harness />); });
    expect(latest.value).toBe(snapshot);
    renderer.unmount();
  });

});
