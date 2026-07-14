export type AssumptionValue = string | number | boolean;

export type PlanningAssumptionSlot =
  | 'duration'
  | 'quantity'
  | 'planning_period'
  | 'priority'
  | 'completion_target';

export type AssumptionUnit =
  | 'minutes'
  | 'hours'
  | 'pages'
  | 'problems'
  | 'words'
  | 'lessons'
  | 'chapters'
  | 'count'
  | 'unknown';

export type AssumptionProposalReasonCode =
  | 'missing_duration'
  | 'missing_quantity'
  | 'missing_planning_period'
  | 'missing_priority'
  | 'missing_completion_target'
  | 'domain_default'
  | 'history_based_estimate'
  | 'first_trial_estimate';

export type AssumptionProposalStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'superseded'
  | 'expired';

export type ProposalResolutionRef =
  | { kind: 'proposal'; proposalId: string }
  | { kind: 'fact'; factId: string }
  | { kind: 'correction'; correctionId: string };

export interface PendingAssumptionProposalDraft {
  slot: PlanningAssumptionSlot;
  targetRef: string;
  proposedValue: AssumptionValue;
  proposedUnit?: AssumptionUnit;
  reasonCode: AssumptionProposalReasonCode;
  sourceFactRefs: string[];
}

export interface AssumptionProposalRecord {
  proposalId: string;
  conversationId: string;
  slot: PlanningAssumptionSlot;
  targetRef: string;
  proposedValue: AssumptionValue;
  proposedUnit?: AssumptionUnit;
  reasonCode: AssumptionProposalReasonCode;
  sourceFactRefs: string[];
  createdAtTurnId: string;
  createdFromStateRevision: number;
  status: AssumptionProposalStatus;
  decidedAtTurnId?: string;
  decidedAtStateRevision?: number;
  resolvedBy?: ProposalResolutionRef;
}

export type PendingAssumptionProposal = AssumptionProposalRecord & {
  status: 'pending';
};

export interface AssumptionProposalSourceFact {
  factId: string;
  userId: string;
  conversationId: string;
  stateRevision: number;
  visibility: 'public' | 'private';
}

export interface AssumptionProposalTargetReference {
  targetRef: string;
  userId: string;
  conversationId: string;
  stateRevision: number;
}

export type AssumptionProposalTargetRef =
  | string
  | AssumptionProposalTargetReference;

export interface AssumptionProposalAuthorizationScope {
  userId: string;
}

export interface AssumptionProposalCanonicalizationContext {
  authorization: AssumptionProposalAuthorizationScope;
  conversationId: string;
  turnId: string;
  stateRevision: number;
  validTargetRefs: readonly AssumptionProposalTargetRef[];
  currentPublicSourceFacts: readonly AssumptionProposalSourceFact[];
  allowedPolicyIds: readonly string[];
  existingProposalRecords: readonly AssumptionProposalRecord[];
}

export interface AssumptionProposalSessionState {
  records: AssumptionProposalRecord[];
}

export const ASSUMPTION_PROPOSAL_LIMITS = {
  targetRef: 200,
  valueString: 500,
  sourceFactRef: 200,
  sourceFactRefs: 8,
  conversationId: 200,
  turnId: 200,
  policyId: 200,
} as const;

export const ASSUMPTION_PROPOSAL_REASON_COMPATIBILITY: Record<
  AssumptionProposalReasonCode,
  { slots: readonly PlanningAssumptionSlot[]; source: 'none' | 'fact' | 'policy-or-fact' }
> = {
  missing_duration: { slots: ['duration'], source: 'none' },
  missing_quantity: { slots: ['quantity'], source: 'none' },
  missing_planning_period: { slots: ['planning_period'], source: 'none' },
  missing_priority: { slots: ['priority'], source: 'none' },
  missing_completion_target: { slots: ['completion_target'], source: 'none' },
  domain_default: {
    slots: ['duration', 'quantity', 'planning_period', 'priority', 'completion_target'],
    source: 'policy-or-fact',
  },
  history_based_estimate: { slots: ['duration', 'quantity'], source: 'fact' },
  first_trial_estimate: { slots: ['duration', 'quantity'], source: 'none' },
};

const ASSUMPTION_SLOTS = new Set<PlanningAssumptionSlot>([
  'duration',
  'quantity',
  'planning_period',
  'priority',
  'completion_target',
]);

const ASSUMPTION_UNITS = new Set<AssumptionUnit>([
  'minutes',
  'hours',
  'pages',
  'problems',
  'words',
  'lessons',
  'chapters',
  'count',
  'unknown',
]);

const DURATION_UNITS = new Set<AssumptionUnit>(['minutes', 'hours']);
const QUANTITY_UNITS = new Set<AssumptionUnit>([
  'pages',
  'problems',
  'words',
  'lessons',
  'chapters',
  'count',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function normalizeBoundedString(
  value: unknown,
  maxLength: number,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.normalize('NFKC').trim();
  return normalized && normalized.length <= maxLength ? normalized : undefined;
}

function normalizeIdentifier(value: unknown, maxLength: number): string | undefined {
  return normalizeBoundedString(value, maxLength);
}

function isFiniteAssumptionValue(value: unknown): value is AssumptionValue {
  return typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && normalizeBoundedString(value, ASSUMPTION_PROPOSAL_LIMITS.valueString) !== undefined);
}

function normalizeAssumptionValue(value: AssumptionValue): AssumptionValue {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim()
    : value;
}

function reject(reason: string): AssumptionProposalValidationResult {
  return { accepted: false, reason };
}

export type AssumptionProposalValidationResult =
  | { accepted: true; draft: PendingAssumptionProposalDraft }
  | { accepted: false; reason: string };

export function validatePendingAssumptionProposalDraft(
  value: unknown,
): AssumptionProposalValidationResult {
  if (!isPlainObject(value)) {
    return reject('draft-not-plain-object');
  }

  const allowedProperties = new Set([
    'slot',
    'targetRef',
    'proposedValue',
    'proposedUnit',
    'reasonCode',
    'sourceFactRefs',
  ]);
  if (Object.keys(value).some((key) => !allowedProperties.has(key))) {
    return reject('unknown-draft-property');
  }

  const slot = value.slot;
  const targetRef = normalizeIdentifier(value.targetRef, ASSUMPTION_PROPOSAL_LIMITS.targetRef);
  const reasonCode = value.reasonCode;
  const proposedUnit = value.proposedUnit;
  const sourceFactRefs = value.sourceFactRefs;

  if (typeof slot !== 'string' || !ASSUMPTION_SLOTS.has(slot as PlanningAssumptionSlot)) {
    return reject('invalid-slot');
  }
  if (!targetRef) {
    return reject('invalid-target-ref');
  }
  if (typeof reasonCode !== 'string'
    || !(reasonCode in ASSUMPTION_PROPOSAL_REASON_COMPATIBILITY)) {
    return reject('unknown-reason-code');
  }
  if (proposedUnit !== undefined
    && (typeof proposedUnit !== 'string'
      || !ASSUMPTION_UNITS.has(proposedUnit as AssumptionUnit))) {
    return reject('invalid-unit');
  }
  if (!isFiniteAssumptionValue(value.proposedValue)) {
    return reject('invalid-proposed-value');
  }
  if (!Array.isArray(sourceFactRefs)
    || sourceFactRefs.length > ASSUMPTION_PROPOSAL_LIMITS.sourceFactRefs
    || sourceFactRefs.some((ref) => !normalizeIdentifier(ref, ASSUMPTION_PROPOSAL_LIMITS.sourceFactRef))) {
    return reject('invalid-source-fact-refs');
  }

  const normalizedSourceFactRefs = Array.from(new Set(
    sourceFactRefs.map((ref) => normalizeIdentifier(ref, ASSUMPTION_PROPOSAL_LIMITS.sourceFactRef) as string),
  )).sort();
  const normalizedSlot = slot as PlanningAssumptionSlot;
  const normalizedReasonCode = reasonCode as AssumptionProposalReasonCode;
  const compatibility = ASSUMPTION_PROPOSAL_REASON_COMPATIBILITY[normalizedReasonCode];

  if (!compatibility.slots.includes(normalizedSlot)) {
    return reject('reason-code-slot-mismatch');
  }

  if (normalizedSlot === 'duration') {
    if (proposedUnit === undefined || !DURATION_UNITS.has(proposedUnit as AssumptionUnit)) {
      return reject('duration-requires-time-unit');
    }
  } else if (normalizedSlot === 'quantity') {
    if (proposedUnit === undefined || !QUANTITY_UNITS.has(proposedUnit as AssumptionUnit)) {
      return reject('quantity-requires-quantity-unit');
    }
  } else if (proposedUnit !== undefined) {
    return reject('unit-not-allowed-for-slot');
  }

  if ((normalizedSlot === 'duration' || normalizedSlot === 'quantity')
    && (typeof value.proposedValue !== 'number'
      || !Number.isFinite(value.proposedValue)
      || value.proposedValue <= 0)) {
    return reject('slot-value-must-be-positive-finite-number');
  }

  return {
    accepted: true,
    draft: {
      slot: normalizedSlot,
      targetRef,
      proposedValue: normalizeAssumptionValue(value.proposedValue as AssumptionValue),
      proposedUnit: proposedUnit as AssumptionUnit | undefined,
      reasonCode: normalizedReasonCode,
      sourceFactRefs: normalizedSourceFactRefs,
    },
  };
}

function targetReferenceId(ref: AssumptionProposalTargetRef): string {
  return typeof ref === 'string' ? ref : ref.targetRef;
}

function targetReferenceMatchesContext(
  targetRef: string,
  context: AssumptionProposalCanonicalizationContext,
): boolean {
  const candidates = context.validTargetRefs.filter(
    (ref) => targetReferenceId(ref).normalize('NFKC').trim() === targetRef,
  );

  if (candidates.length === 0) {
    return false;
  }

  return candidates.some((ref) => typeof ref === 'string'
    || (
      ref.userId === context.authorization.userId
      && ref.conversationId === context.conversationId
      && ref.stateRevision === context.stateRevision
    ));
}

function sourceFactRefsForContext(
  refs: readonly string[],
  context: AssumptionProposalCanonicalizationContext,
): { validFactRefs: string[]; policyRefs: string[]; reason?: string } {
  const facts = context.currentPublicSourceFacts;
  const allowedPolicies = new Set(context.allowedPolicyIds.map((id) =>
    normalizeIdentifier(id, ASSUMPTION_PROPOSAL_LIMITS.policyId),
  ).filter((id): id is string => Boolean(id)));
  const validFactRefs: string[] = [];
  const policyRefs: string[] = [];

  for (const ref of refs) {
    if (allowedPolicies.has(ref)) {
      policyRefs.push(ref);
      continue;
    }

    const fact = facts.find((candidate) =>
      candidate.factId.normalize('NFKC').trim() === ref,
    );
    if (!fact) {
      return { validFactRefs, policyRefs, reason: 'unknown-source-fact' };
    }
    if (fact.visibility !== 'public') {
      return { validFactRefs, policyRefs, reason: 'private-source-fact' };
    }
    if (fact.userId !== context.authorization.userId) {
      return { validFactRefs, policyRefs, reason: 'cross-user-source-fact' };
    }
    if (fact.conversationId !== context.conversationId) {
      return { validFactRefs, policyRefs, reason: 'cross-conversation-source-fact' };
    }
    if (fact.stateRevision !== context.stateRevision) {
      return { validFactRefs, policyRefs, reason: 'stale-source-fact' };
    }
    validFactRefs.push(ref);
  }

  return { validFactRefs, policyRefs };
}

function canonicalSerialization(params: {
  userId: string;
  conversationId: string;
  turnId: string;
  stateRevision: number;
  draft: PendingAssumptionProposalDraft;
}): string {
  return JSON.stringify([
    params.userId,
    params.conversationId,
    params.turnId,
    params.stateRevision,
    params.draft.slot,
    params.draft.targetRef,
    params.draft.proposedValue,
    params.draft.proposedUnit ?? null,
    params.draft.reasonCode,
    [...params.draft.sourceFactRefs].sort(),
  ]);
}

function deterministicHash(value: string): string {
  let hash = 14695981039346656037n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 1099511628211n);
  }
  return hash.toString(16).padStart(16, '0');
}

export function createDeterministicAssumptionProposalId(
  context: AssumptionProposalCanonicalizationContext,
  draft: PendingAssumptionProposalDraft,
): string {
  return 'assumption:' + deterministicHash(canonicalSerialization({
    userId: context.authorization.userId,
    conversationId: context.conversationId,
    turnId: context.turnId,
    stateRevision: context.stateRevision,
    draft,
  }));
}

function recordsEqual(
  left: AssumptionProposalRecord,
  right: AssumptionProposalRecord,
): boolean {
  return left.proposalId === right.proposalId
    && left.conversationId === right.conversationId
    && left.slot === right.slot
    && left.targetRef === right.targetRef
    && left.proposedValue === right.proposedValue
    && left.proposedUnit === right.proposedUnit
    && left.reasonCode === right.reasonCode
    && JSON.stringify(left.sourceFactRefs) === JSON.stringify(right.sourceFactRefs)
    && left.createdAtTurnId === right.createdAtTurnId
    && left.createdFromStateRevision === right.createdFromStateRevision
    && left.status === right.status;
}

export type AssumptionProposalCanonicalizationResult =
  | {
      accepted: true;
      record: PendingAssumptionProposal;
      assumptionProposalRef: string;
      duplicate: boolean;
    }
  | {
      accepted: false;
      reason: string;
    };

export function canonicalizeAssumptionProposalDraft(
  value: unknown,
  context: AssumptionProposalCanonicalizationContext,
): AssumptionProposalCanonicalizationResult {
  const validation = validatePendingAssumptionProposalDraft(value);
  if (!validation.accepted) {
    return validation;
  }

  const draft = validation.draft;
  if (!normalizeIdentifier(context.authorization.userId, ASSUMPTION_PROPOSAL_LIMITS.conversationId)
    || !normalizeIdentifier(context.conversationId, ASSUMPTION_PROPOSAL_LIMITS.conversationId)
    || !normalizeIdentifier(context.turnId, ASSUMPTION_PROPOSAL_LIMITS.turnId)
    || !Number.isInteger(context.stateRevision)
    || context.stateRevision < 0) {
    return { accepted: false, reason: 'invalid-canonicalization-context' };
  }
  if (!targetReferenceMatchesContext(draft.targetRef, context)) {
    return { accepted: false, reason: 'unknown-or-invalid-target-ref' };
  }

  const sourceValidation = sourceFactRefsForContext(draft.sourceFactRefs, context);
  if (sourceValidation.reason) {
    return { accepted: false, reason: sourceValidation.reason };
  }

  const compatibility = ASSUMPTION_PROPOSAL_REASON_COMPATIBILITY[draft.reasonCode];
  if (compatibility.source === 'fact' && sourceValidation.validFactRefs.length === 0) {
    return { accepted: false, reason: 'reason-requires-public-source-fact' };
  }
  if (compatibility.source === 'policy-or-fact'
    && sourceValidation.validFactRefs.length === 0
    && sourceValidation.policyRefs.length === 0) {
    return { accepted: false, reason: 'domain-default-requires-policy-or-source-fact' };
  }
  if (sourceValidation.policyRefs.length > 0 && draft.reasonCode !== 'domain_default') {
    return { accepted: false, reason: 'policy-source-not-allowed-for-reason' };
  }

  const normalizedDraft: PendingAssumptionProposalDraft = {
    ...draft,
    sourceFactRefs: [...sourceValidation.validFactRefs, ...sourceValidation.policyRefs].sort(),
  };
  const proposalId = createDeterministicAssumptionProposalId(context, normalizedDraft);
  const existing = context.existingProposalRecords.find((record) => record.proposalId === proposalId);

  if (existing) {
    if (existing.status !== 'pending' || !recordsEqual(existing, {
      proposalId,
      conversationId: context.conversationId,
      slot: normalizedDraft.slot,
      targetRef: normalizedDraft.targetRef,
      proposedValue: normalizedDraft.proposedValue,
      proposedUnit: normalizedDraft.proposedUnit,
      reasonCode: normalizedDraft.reasonCode,
      sourceFactRefs: normalizedDraft.sourceFactRefs,
      createdAtTurnId: context.turnId,
      createdFromStateRevision: context.stateRevision,
      status: 'pending',
    })) {
      return { accepted: false, reason: 'proposal-id-collision' };
    }

    return {
      accepted: true,
      record: existing as PendingAssumptionProposal,
      assumptionProposalRef: existing.proposalId,
      duplicate: true,
    };
  }

  const conflictingPending = context.existingProposalRecords.find((record) =>
    record.status === 'pending'
      && record.conversationId === context.conversationId
      && record.slot === normalizedDraft.slot
      && record.targetRef.normalize('NFKC').trim() === normalizedDraft.targetRef,
  );
  if (conflictingPending) {
    return { accepted: false, reason: 'pending-proposal-conflict' };
  }

  const record: PendingAssumptionProposal = {
    proposalId,
    conversationId: context.conversationId,
    slot: normalizedDraft.slot,
    targetRef: normalizedDraft.targetRef,
    proposedValue: normalizedDraft.proposedValue,
    proposedUnit: normalizedDraft.proposedUnit,
    reasonCode: normalizedDraft.reasonCode,
    sourceFactRefs: [...normalizedDraft.sourceFactRefs],
    createdAtTurnId: context.turnId,
    createdFromStateRevision: context.stateRevision,
    status: 'pending',
  };

  return {
    accepted: true,
    record,
    assumptionProposalRef: proposalId,
    duplicate: false,
  };
}

export interface AssumptionProposalBatchResult {
  state: AssumptionProposalSessionState;
  accepted: PendingAssumptionProposal[];
  rejected: Array<{ draft: unknown; reason: string }>;
  assumptionProposalRefs: string[];
}

export function createAssumptionProposalSessionState(
  records: readonly AssumptionProposalRecord[] = [],
): AssumptionProposalSessionState {
  return {
    records: records.map((record) => ({
      ...record,
      sourceFactRefs: [...record.sourceFactRefs],
    })),
  };
}

export function canonicalizeAssumptionProposalDrafts(
  drafts: readonly unknown[],
  context: AssumptionProposalCanonicalizationContext,
): AssumptionProposalBatchResult {
  const state = createAssumptionProposalSessionState(context.existingProposalRecords);
  const accepted = new Map<string, PendingAssumptionProposal>();
  const rejected: Array<{ draft: unknown; reason: string }> = [];

  drafts.forEach((draft) => {
    const result = canonicalizeAssumptionProposalDraft(draft, {
      ...context,
      existingProposalRecords: state.records,
    });
    if (!result.accepted) {
      rejected.push({ draft, reason: result.reason });
      return;
    }

    accepted.set(result.record.proposalId, result.record);
    if (!state.records.some((record) => record.proposalId === result.record.proposalId)) {
      state.records.push({
        ...result.record,
        sourceFactRefs: [...result.record.sourceFactRefs],
      });
    }
  });

  return {
    state,
    accepted: [...accepted.values()],
    rejected,
    assumptionProposalRefs: [...accepted.keys()],
  };
}

export function getPendingAssumptionProposals(
  state: AssumptionProposalSessionState | readonly AssumptionProposalRecord[],
): PendingAssumptionProposal[] {
  const records: readonly AssumptionProposalRecord[] = 'records' in state ? state.records : state;
  return records
    .filter((record): record is PendingAssumptionProposal => record.status === 'pending')
    .map((record) => ({
      ...record,
      sourceFactRefs: [...record.sourceFactRefs],
    }));
}

export function getAssumptionProposalRef(
  proposal: PendingAssumptionProposal | AssumptionProposalRecord,
): string {
  return proposal.proposalId;
}
