/**
 * Application-owned statement that a free-form point was released and stays unconfirmed (Issue #488 H-release).
 * It states the release, never the plan (the same turn may ask another question or find no capacity). The quote is
 * the user's own verbatim words (uncertainty quotes are grounded in a user turn, never in model text), capped like
 * the question excerpt; without one the sentence stays generic. When the reply applied nothing at all (a no-delta
 * release), the application also says so, so a condition the reading dropped is never silent. The renderer never
 * words this.
 */
const QUOTE_LIMIT = 80;
const GENERIC = '未確定の点は未確定のまま進めます。';
const NOTHING_READ = 'この返事からは新しい条件を読み取っていません。条件があれば、あらためて教えてください。';

export function weeklyPlanningUncertaintyReleaseText(release: { quote: string | null | undefined; nothingRead?: boolean }): string {
  const normalized = (release.quote ?? '').replace(/\s+/g, ' ').trim();
  const excerpt = normalized.length <= QUOTE_LIMIT ? normalized : `${normalized.slice(0, QUOTE_LIMIT)}…`;
  const released = normalized ? `「${excerpt}」については未確定のまま進めます。` : GENERIC;
  return release.nothingRead ? `${released}${NOTHING_READ}` : released;
}
