import { useLayoutEffect, useRef, type RefObject } from 'react';
import { allowsSpatialMotion } from '../lib/motionPreference';
import { measureAtRest, playEntrance, playSettle, playShift } from '../lib/motionEffects';

/**
 * Explains data changes inside one view without re-rendering it.
 *
 * Items declare themselves in markup: `data-motion-key` is a key unique within
 * the container, and `data-motion-signature` is everything about the item the
 * user would see change (date, time, title…). After a commit in which `data`
 * changed, items that did not exist before play an entrance, items whose
 * signature changed play a settle, and unchanged items that the change pushed
 * elsewhere (a neighbour was removed, added or resized) glide from where they
 * were drawn to their new place.
 *
 * Only data changes animate. The baseline is refreshed on every commit, so
 * items revealed by navigation, a display setting or a mode switch never
 * replay later. The first render and the first render of another `scope`
 * (day/week/month or view mode) only record a baseline. Removed items simply
 * disappear so the next action is never delayed; the gap they leave closes
 * through the glide of the items that remain.
 */
export function useDataChangeMotion(
  containerRef: RefObject<Element | null>,
  scope: string,
  data: readonly unknown[],
) {
  const previous = useRef<{ scope: string; data: readonly unknown[]; signatures: Map<string, string> } | null>(null);
  const drawnBefore = useRef<{ data: readonly unknown[]; positions: Map<string, Placement> } | null>(null);

  // While rendering a data change the DOM still shows the previous layout, so
  // this is the one moment where "where it was drawn" can be read. Reading
  // includes any glide still in flight, so a quick second change continues
  // from the visible position.
  const committed = previous.current;
  if (committed && committed.scope === scope && !sameData(committed.data, data)
    && (!drawnBefore.current || !sameData(drawnBefore.current.data, data)) && allowsSpatialMotion()) {
    drawnBefore.current = { data, positions: readPositions(containerRef.current) };
  }

  useLayoutEffect(() => {
    const container = containerRef.current;
    const drawn = drawnBefore.current;
    drawnBefore.current = null;
    if (!container || typeof container.querySelectorAll !== 'function') {
      previous.current = null;
      return;
    }
    const elements = Array.from(container.querySelectorAll<HTMLElement>('[data-motion-key]'));
    const signatures = new Map(elements.map(element => [element.dataset.motionKey ?? '', element.dataset.motionSignature ?? '']));
    const before = previous.current;
    previous.current = { scope, data, signatures };
    if (!before || before.scope !== scope || sameData(before.data, data)) return;

    const shifts: Array<{ element: HTMLElement; x: number; y: number }> = [];
    // Geometry is only used for spatial glides. Reduced fades and off
    // still refresh signatures, but must not force layout for unused positions.
    const spatial = allowsSpatialMotion();
    const origin = spatial ? positionOf(container, null) : null;
    for (const element of elements) {
      const key = element.dataset.motionKey ?? '';
      const prior = before.signatures.get(key);
      if (prior === undefined) playEntrance(element);
      else if (prior !== (element.dataset.motionSignature ?? '')) playSettle(element);
      else if (spatial) {
        const from = drawn && sameData(drawn.data, data) ? drawn.positions.get(key) : undefined;
        // Where it now rests, not where an earlier glide still draws it.
        const to = origin && measureAtRest(element, () => positionOf(element, origin));
        if (!from || !to) continue;
        // Its own place did not change: a glide still running from an earlier
        // change simply continues.
        if (Math.round(from.rest.x - to.x) === 0 && Math.round(from.rest.y - to.y) === 0) continue;
        // The new glide replaces any running one and starts from the drawn point.
        const x = Math.round(from.drawn.x - to.x);
        const y = Math.round(from.drawn.y - to.y);
        if (x !== 0 || y !== 0) shifts.push({ element, x, y });
      }
    }
    // A change that moves most of the view (a different layout rather than a
    // neighbour coming or going) reads as noise when every item glides.
    if (shifts.length > MAX_SHIFTS) return;
    for (const { element, x, y } of shifts) playShift(element, x, y);
  });
}

/** Beyond this many items a reflow is shown as-is rather than glided. */
const MAX_SHIFTS = 24;

interface Point { x: number; y: number }
/** Where an item is drawn (including a running effect) and where it rests. */
interface Placement { drawn: Point; rest: Point }

function positionOf(element: Element, origin: Point | null): Point | null {
  if (typeof element.getBoundingClientRect !== 'function') return null;
  const box = element.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) return null;
  return origin ? { x: box.left - origin.x, y: box.top - origin.y } : { x: box.left, y: box.top };
}

function readPositions(container: Element | null): Map<string, Placement> {
  const positions = new Map<string, Placement>();
  if (!container || typeof container.querySelectorAll !== 'function') return positions;
  const origin = positionOf(container, null);
  if (!origin) return positions;
  for (const element of Array.from(container.querySelectorAll<HTMLElement>('[data-motion-key]'))) {
    const drawn = positionOf(element, origin);
    const rest = measureAtRest(element, () => positionOf(element, origin));
    if (drawn && rest) positions.set(element.dataset.motionKey ?? '', { drawn, rest });
  }
  return positions;
}

function sameData(left: readonly unknown[], right: readonly unknown[]) {
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
}
