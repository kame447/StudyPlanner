/**
 * Application-owned statement that a free-form point was left unconfirmed (Issue #488 H-release). The
 * quote is the user's own verbatim words (uncertainty quotes are grounded in a user turn, never in model
 * text), capped like the question excerpt; without one the sentence stays generic. The renderer never
 * words this.
 */
const QUOTE_LIMIT = 80;
const GENERIC = 'いくつか未確定の点を残したまま、仮予定を作りました。';

export function weeklyPlanningUncertaintyReleaseText(quote: string | null | undefined): string {
  const normalized = (quote ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return GENERIC;
  const excerpt = normalized.length <= QUOTE_LIMIT ? normalized : `${normalized.slice(0, QUOTE_LIMIT)}…`;
  return `「${excerpt}」について未確定の点を残したまま、仮予定を作りました。`;
}
