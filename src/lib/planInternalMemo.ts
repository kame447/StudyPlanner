/**
 * Weekly planning used to write its own bookkeeping into a plan's memo: `Stable V5 preview / graphRevision: N / workItemKey: K`
 * (and an older `year / estimatedMinutes / workItemKey / source: dry-run preview` form), then, on saving,
 * `[weekly-source:<blockId>] / [weekly-approval:<operationId>]`. New saves no longer write them, but saved plans keep them.
 * The memo is the user's own text and is shown to them, so these segments are hidden from display and editing. They are
 * not removed from the stored memo: an older approval still finds its plan through `[weekly-source:…]`.
 *
 * Only these exact, ASCII, machine-written segments (joined by " / ") are internal; no free text is interpreted.
 */
const SEPARATOR = ' / ';
const ALWAYS_INTERNAL = [
  /^Stable V5 preview$/u,
  /^graphRevision: \d+$/u,
  /^workItemKey: \S.*$/u,
  /^unsaved-preview: \S.*$/u,
  /^\[weekly-source:[^\]]*\]$/u,
  /^\[weekly-approval:[^\]]*\]$/u,
];
// Only part of the older dry-run form, and only next to its workItemKey, so a user's own "year: 2020" is never hidden.
const DRY_RUN_FORM = [/^year: \d+$/u, /^estimatedMinutes: \d+$/u, /^source: dry-run preview$/u];

export interface SplitPlanMemo {
  /** What the user wrote (and sees). Equal to the stored memo when it has no internal segment. */
  visible: string;
  /** The internal segments, in their stored order. */
  internal: string[];
}

export function splitPlanMemoInternalSegments(memo: string): SplitPlanMemo {
  // Internal segments are only ever appended after the user's text, so they are read from the end. Splitting on every
  // " / " would also cut the user's own text (a memo typed as "A / B" passes through "A /" while it is being typed).
  const hasDryRunKey = /(?:^|\s\/\s)workItemKey: \S/u.test(memo);
  const isInternal = (segment: string) => ALWAYS_INTERNAL.some(pattern => pattern.test(segment))
    || (hasDryRunKey && DRY_RUN_FORM.some(pattern => pattern.test(segment)));
  const internal: string[] = [];
  let rest = memo;
  for (;;) {
    const cut = rest.lastIndexOf(SEPARATOR);
    const tail = cut < 0 ? rest : rest.slice(cut + SEPARATOR.length);
    if (!isInternal(tail)) break;
    internal.unshift(tail);
    if (cut < 0) { rest = ''; break; }
    rest = rest.slice(0, cut);
  }
  return internal.length ? { visible: rest, internal } : { visible: memo, internal: [] };
}

/** The memo as the user should see it. */
export function visiblePlanMemo(memo: string): string {
  return splitPlanMemoInternalSegments(memo).visible;
}

/** The memo to store after the user edited the visible text: their text replaces the visible part; internal segments stay. */
export function mergeEditedPlanMemo(storedMemo: string, editedVisible: string): string {
  const { internal } = splitPlanMemoInternalSegments(storedMemo);
  if (!internal.length) return editedVisible;
  return [...(editedVisible === '' ? [] : [editedVisible]), ...internal].join(SEPARATOR);
}
