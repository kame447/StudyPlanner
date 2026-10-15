import { useLayoutEffect, useRef, type RefObject } from 'react';
import { playEntrance, playSettle } from '../lib/motionEffects';

/**
 * Explains data changes inside one view without re-rendering it.
 *
 * Items declare themselves in markup: `data-motion-key` is a key unique within
 * the container, and `data-motion-signature` is everything about the item the
 * user would see change (date, time, title…). After a commit in which `data`
 * changed, items that did not exist before play an entrance and items whose
 * signature changed play a settle.
 *
 * Only data changes animate. The baseline is refreshed on every commit, so
 * items revealed by navigation, a display setting or a mode switch never
 * replay later. The first render and the first render of another `scope`
 * (day/week/month or view mode) only record a baseline. Removed items simply
 * disappear so the next action is never delayed.
 */
export function useDataChangeMotion(
  containerRef: RefObject<Element | null>,
  scope: string,
  data: readonly unknown[],
) {
  const previous = useRef<{ scope: string; data: readonly unknown[]; signatures: Map<string, string> } | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || typeof container.querySelectorAll !== 'function') {
      previous.current = null;
      return;
    }
    const elements = Array.from(container.querySelectorAll<HTMLElement>('[data-motion-key]'));
    const signatures = new Map(elements.map(element => [element.dataset.motionKey ?? '', element.dataset.motionSignature ?? '']));
    const before = previous.current;
    previous.current = { scope, data, signatures };
    if (!before || before.scope !== scope || sameData(before.data, data)) return;

    for (const element of elements) {
      const prior = before.signatures.get(element.dataset.motionKey ?? '');
      if (prior === undefined) playEntrance(element);
      else if (prior !== (element.dataset.motionSignature ?? '')) playSettle(element);
    }
  });
}

function sameData(left: readonly unknown[], right: readonly unknown[]) {
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
}
