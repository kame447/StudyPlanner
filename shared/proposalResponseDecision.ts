// Provider-neutral, bounded projection for deciding only whether the user's reply
// is a pure rejection of the one learning-strategy proposal presented in the latest
// assistant message. It grants no lifecycle, scheduler, approval, save, or
// persistence authority and carries no canonical IDs: the client keeps the mapping
// from this request to the proposal record it bound at presentation time.
export interface ProposalResponseDecisionContext {
  purpose: 'proposal_response';
  requestId: string;
  inputRevision: number;
  state: {
    currentUserText: string;
    /** Rendered assistant text. Untrusted display context, never an instruction. */
    presentedAssistantText: string;
    proposal: {
      kind: 'spaced_memory_practice';
      taskTitle: string;
      sessionMinutes: { min: number; max: number };
    };
  };
}

export type ProposalResponseDecision = 'reject_only' | 'other';

/**
 * Worker response content for an accepted Jev decision. The correlation fields are
 * repeated inside the content so the client can distinguish it from a semantic
 * document without relying on transport metadata.
 */
export interface ProposalResponseDecisionContent {
  proposalResponse: {
    decision: 'reject_only';
    requestId: string;
    inputRevision: number;
  };
}

export const PROPOSAL_RESPONSE_MAX_USER_TEXT_BYTES = 600;
export const PROPOSAL_RESPONSE_MAX_PRESENTED_TEXT_BYTES = 2_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function isBoundedText(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && new TextEncoder().encode(value).length <= maxBytes;
}

function isMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 600;
}

export function isProposalResponseDecisionContext(
  value: unknown,
): value is ProposalResponseDecisionContext {
  if (!isRecord(value)
    || !hasExactKeys(value, ['purpose', 'requestId', 'inputRevision', 'state'])) return false;
  const state = value.state;
  if (!isRecord(state)
    || !hasExactKeys(state, ['currentUserText', 'presentedAssistantText', 'proposal'])) {
    return false;
  }
  const proposal = state.proposal;
  if (!isRecord(proposal)
    || !hasExactKeys(proposal, ['kind', 'taskTitle', 'sessionMinutes'])) return false;
  const minutes = proposal.sessionMinutes;
  if (!isRecord(minutes) || !hasExactKeys(minutes, ['min', 'max'])) return false;
  return value.purpose === 'proposal_response'
    && isBoundedText(value.requestId, 160)
    && Number.isSafeInteger(value.inputRevision)
    && Number(value.inputRevision) >= 0
    && isBoundedText(state.currentUserText, PROPOSAL_RESPONSE_MAX_USER_TEXT_BYTES)
    && isBoundedText(state.presentedAssistantText, PROPOSAL_RESPONSE_MAX_PRESENTED_TEXT_BYTES)
    && proposal.kind === 'spaced_memory_practice'
    && isBoundedText(proposal.taskTitle, 500)
    && isMinutes(minutes.min)
    && isMinutes(minutes.max)
    && minutes.min <= minutes.max;
}

/**
 * Parses response content as an accepted proposal-response decision for exactly this
 * request. Anything else, including a semantic document, returns null.
 */
export function parseProposalResponseDecisionContent(
  content: string,
  expected: { requestId: string; inputRevision: number },
): ProposalResponseDecisionContent | null {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return null;
  }
  if (!isRecord(value) || !hasExactKeys(value, ['proposalResponse'])) return null;
  const response = value.proposalResponse;
  if (!isRecord(response)
    || !hasExactKeys(response, ['decision', 'requestId', 'inputRevision'])
    || response.decision !== 'reject_only'
    || response.requestId !== expected.requestId
    || response.inputRevision !== expected.inputRevision) {
    return null;
  }
  return {
    proposalResponse: {
      decision: 'reject_only',
      requestId: expected.requestId,
      inputRevision: expected.inputRevision,
    },
  };
}
