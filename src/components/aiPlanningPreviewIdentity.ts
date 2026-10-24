/**
 * Which proposal the preview is showing. A revised plan from the conversation
 * arrives with new block ids; when no block of the previous proposal
 * survives, it is a different proposal rather than an edit of this one, and
 * the preview shows it as a new view instead of "every block was added".
 * Excluding every block leaves nothing to compare a later proposal with, so
 * the last non-empty proposal is kept as the reference.
 */
export interface PreviewProposalIdentity {
  ids: ReadonlySet<string>;
  generation: number;
}

export const INITIAL_PREVIEW_PROPOSAL: PreviewProposalIdentity = { ids: new Set(), generation: 0 };

export function nextPreviewProposal(
  previous: PreviewProposalIdentity,
  blockIds: readonly string[],
): PreviewProposalIdentity {
  if (blockIds.length === 0) return previous;
  const replaced = previous.ids.size > 0 && !blockIds.some((id) => previous.ids.has(id));
  return { ids: new Set(blockIds), generation: previous.generation + (replaced ? 1 : 0) };
}
