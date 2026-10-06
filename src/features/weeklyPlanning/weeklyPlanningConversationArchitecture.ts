import type { PlanningState } from './types';

/**
 * Conversation architecture of a weekly-planning conversation (Issue #488 comparison switch).
 *
 * - `legacy_v5`: the Stable V5 conversation/control flow as it was before Issue #488
 *   (raw pending-question binding, no conversation acts, generic failure presentation,
 *   renderer decides "explain" from the raw user message, unbounded historical retries).
 * - `interaction_v1`: the three-responsibility interaction model (semantic interpretation /
 *   deterministic interaction decision / deterministic planner) introduced by Issue #488.
 *
 * The mode changes conversation interpretation and presentation ONLY. Neither mode touches
 * Fact Graph validation/provenance, revision/idempotency, scheduler/preview safety, explicit
 * save approval or owner/chat isolation; those boundaries are not parameterised here.
 *
 * Ownership: this module is the pure vocabulary and capability policy. The only readers of
 * environment variables / browser storage live in
 * `weeklyPlanningConversationArchitecturePreference.ts`; every other module receives the
 * mode (or the policy derived from it) as a typed value at the turn boundary.
 */
export const WEEKLY_PLANNING_CONVERSATION_ARCHITECTURES = [
  'legacy_v5',
  'interaction_v1',
] as const;

export type WeeklyPlanningConversationArchitecture =
  typeof WEEKLY_PLANNING_CONVERSATION_ARCHITECTURES[number];

/** New conversations use the new architecture unless explicitly configured otherwise. */
export const WEEKLY_PLANNING_DEFAULT_CONVERSATION_ARCHITECTURE: WeeklyPlanningConversationArchitecture =
  'interaction_v1';

export const WEEKLY_PLANNING_CONVERSATION_ARCHITECTURE_LABELS: Readonly<
  Record<WeeklyPlanningConversationArchitecture, string>
> = {
  legacy_v5: '旧Stable V5',
  interaction_v1: '新Interaction V1',
};

export function isWeeklyPlanningConversationArchitecture(
  value: unknown,
): value is WeeklyPlanningConversationArchitecture {
  return typeof value === 'string'
    && (WEEKLY_PLANNING_CONVERSATION_ARCHITECTURES as readonly string[]).includes(value);
}

/**
 * Named capabilities of an architecture. Each bit corresponds to one behaviour Issue #488
 * introduced; the two architectures are the only supported combinations (there is no
 * per-feature toggle), so a conversation can never be a mixture of the two.
 */
export interface WeeklyPlanningConversationArchitecturePolicy {
  readonly architecture: WeeklyPlanningConversationArchitecture;
  /** Provider schema/prompt/validation include typed `conversationActs`. */
  readonly semanticConversationActs: boolean;
  /**
   * The pending question is offered to the model and to short-answer binding only while its
   * presentation is fresh (presented by the latest committed message). Legacy reads the raw
   * previous machine question and stamps it with the current graph revision.
   */
  readonly freshPendingQuestionBinding: boolean;
  /** A bare typed act is a complete result: no-op completeness retry is suppressed for it. */
  readonly actAwareNoOpRetry: boolean;
  /** Deterministic interaction decision/outcome and the typed renderer outcome (explain/aside/resume). */
  readonly interactionOutcome: boolean;
  /** A failed turn retains machine state and re-presents the question conversationally. */
  readonly conversationalFailureRecovery: boolean;
  /** The per-turn AI dispatch pool is enforced (counting is always on, see measurement). */
  readonly enforceTurnDispatchBudget: boolean;
  /** Proposal decisions apply only to the fresh presented proposal. */
  readonly freshProposalDecisionsOnly: boolean;
}

const INTERACTION_POLICY: WeeklyPlanningConversationArchitecturePolicy = {
  architecture: 'interaction_v1',
  semanticConversationActs: true,
  freshPendingQuestionBinding: true,
  actAwareNoOpRetry: true,
  interactionOutcome: true,
  conversationalFailureRecovery: true,
  enforceTurnDispatchBudget: true,
  freshProposalDecisionsOnly: true,
};

const LEGACY_POLICY: WeeklyPlanningConversationArchitecturePolicy = {
  architecture: 'legacy_v5',
  semanticConversationActs: false,
  freshPendingQuestionBinding: false,
  actAwareNoOpRetry: false,
  interactionOutcome: false,
  conversationalFailureRecovery: false,
  enforceTurnDispatchBudget: false,
  freshProposalDecisionsOnly: false,
};

/**
 * Policy for a mode. `undefined` means the current default architecture and exists for pure
 * callers (unit tests, tools) that do not run a conversation; every production turn passes
 * the mode its conversation is pinned to.
 */
export function conversationArchitecturePolicy(
  architecture?: WeeklyPlanningConversationArchitecture,
): WeeklyPlanningConversationArchitecturePolicy {
  return (architecture ?? WEEKLY_PLANNING_DEFAULT_CONVERSATION_ARCHITECTURE) === 'legacy_v5'
    ? LEGACY_POLICY
    : INTERACTION_POLICY;
}

/**
 * True when a turn has already been admitted in this conversation (or it holds state a turn
 * produced). Such a state with no pinned architecture was authored before the field existed,
 * i.e. under the legacy architecture. A message appended without any admitted turn (a notice,
 * a restored transcript) is not a conversation under either architecture yet, so it stays
 * unpinned and captures the default at its first turn - this keeps the stored form and the
 * in-memory form of the same state identical.
 */
export function planningStateHasConversationContent(
  state: Pick<PlanningState, 'intakeState' | 'conversationRequestSequence' | 'draftBlocks'>
    & Partial<Pick<PlanningState, 'previewCandidates'>>,
): boolean {
  return Boolean(state.intakeState)
    || (state.conversationRequestSequence ?? 0) > 0
    || state.draftBlocks.length > 0
    || (state.previewCandidates?.length ?? 0) > 0;
}

/**
 * The architecture the next turn of this conversation runs under:
 * 1. the pinned mode, if the conversation has one (a pinned conversation never changes);
 * 2. a conversation with content but no pin predates the field → `legacy_v5`
 *    (never silently migrated into interaction semantics);
 * 3. an empty conversation captures `newConversationDefault` (the single capture point).
 */
export function resolveConversationArchitectureForTurn(
  state: Parameters<typeof planningStateHasConversationContent>[0]
    & Pick<PlanningState, 'conversationArchitecture'>,
  newConversationDefault: WeeklyPlanningConversationArchitecture,
): WeeklyPlanningConversationArchitecture {
  if (state.conversationArchitecture) return state.conversationArchitecture;
  return planningStateHasConversationContent(state) ? 'legacy_v5' : newConversationDefault;
}

/**
 * Codec hydration of a stored/snapshot state: the pinned mode as stored, or - for a
 * checkpoint authored before the field existed - `legacy_v5` when it has conversation content.
 * Returns an object to spread so an empty conversation stays unpinned (no key at all).
 */
export function hydratedConversationArchitecture(
  state: Parameters<typeof planningStateHasConversationContent>[0]
    & Pick<PlanningState, 'conversationArchitecture'>,
): { conversationArchitecture?: WeeklyPlanningConversationArchitecture } {
  if (state.conversationArchitecture) {
    return { conversationArchitecture: state.conversationArchitecture };
  }
  return planningStateHasConversationContent(state) ? { conversationArchitecture: 'legacy_v5' } : {};
}
