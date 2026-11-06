// Exact run-specific title, optionally followed by the scheduler's displayed duration.
export function isSavedPlanTitle(blockTitle, title) {
  if (blockTitle === title) return true;
  const prefix = title + ' ';
  return blockTitle.startsWith(prefix) && /^\d+(?:\.\d+)?(?:分|時間)$/u.test(blockTitle.slice(prefix.length));
}
