import type {
  AssumptionProposalRecord,
  AssumptionUnit,
  AssumptionValue,
  ProposalResolutionRef,
} from '../intake/weeklyPlanningAssumptionProposals';
import { applyWeeklyPlanningCommands } from '../intake/weeklyPlanningIntakeReducer';
import type { ParsedWeeklyPlanningCommand } from '../intake/weeklyPlanningCommandTypes';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';

export type AssumptionDecisionCommand =
  | {
      type: 'accept_assumption';
      proposalId: string;
      expectedStateRevision: number;
      sourceText: string;
      confidence: 'high';
    }
  | {
      type: 'reject_assumption';
      proposalId: string;
      expectedStateRevision: number;
      sourceText: string;
      confidence: 'high';
    }
  | {
      type: 'modify_assumption';
      proposalId: string;
      expectedStateRevision: number;
      replacementValue: AssumptionValue;
      replacementUnit?: AssumptionUnit;
      sourceText: string;
      confidence: 'high';
    };

export type CorrectionTarget =
  | { kind: 'task'; taskRef: string }
  | { kind: 'planning_range'; rangeRef: 'current' }
  | { kind: 'constraint'; constraintRef: string }
  | { kind: 'priority'; priorityRef: 'current' }
  | { kind: 'accepted_fact'; factRef: string }
  | { kind: 'proposal'; proposalId: string };

export type CorrectionOperation = 'replace' | 'remove' | 'supersede' | 'restore';

export interface CorrectionEnvelope {
  correctionId: string;
  conversationId: string;
  expectedStateRevision: number;
  operation: CorrectionOperation;
  target: CorrectionTarget;
  replacementCommand?: ParsedWeeklyPlanningCommand;
  sourceText: string;
}

export interface AssumptionLifecycleContext {
  conversationId: string;
  turnId: string;
  currentStateRevision: number;
}

export type AssumptionDecisionValidation =
  | { accepted: true; command: AssumptionDecisionCommand; record: AssumptionProposalRecord }
  | { accepted: false; reason: string };

export interface AcceptedAssumptionFact {
  factId: string;
  proposalId: string;
  targetRef: string;
  slot: AssumptionProposalRecord['slot'];
  value: AssumptionValue;
  unit?: AssumptionUnit;
}

export interface AssumptionDecisionApplyResult {
  records: AssumptionProposalRecord[];
  acceptedFact?: AcceptedAssumptionFact;
  replacementProposal?: AssumptionProposalRecord;
  nextStateRevision: number;
}

export interface CorrectionBatchResult {
  state: PlanningIntakeState;
  records: AssumptionProposalRecord[];
  accepted: CorrectionEnvelope[];
  rejected: Array<{ envelope: CorrectionEnvelope; reason: string }>;
  previewStale: boolean;
  nextStateRevision: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
}

function finiteRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function finiteAssumptionValue(value: unknown): value is AssumptionValue {
  return typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && value.trim().length > 0 && value.length <= 500);
}

function cloneRecord(record: AssumptionProposalRecord): AssumptionProposalRecord {
  return {
    ...record,
    sourceFactRefs: [...record.sourceFactRefs],
    resolvedBy: record.resolvedBy ? { ...record.resolvedBy } : undefined,
  };
}

function deterministicReplacementProposalId(params: {
  proposalId: string;
  turnId: string;
  stateRevision: number;
}): string {
  let hash = 2166136261;
  const source = `${params.proposalId}\u001f${params.turnId}\u001f${params.stateRevision}`;
  for (const character of source) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `${params.proposalId}:replacement:${(hash >>> 0).toString(16)}`;
}

function decisionProperties(type: AssumptionDecisionCommand['type']): Set<string> {
  const common = ['type', 'proposalId', 'expectedStateRevision', 'sourceText', 'confidence'];
  return new Set(type === 'modify_assumption'
    ? [...common, 'replacementValue', 'replacementUnit']
    : common);
}

export function validateAssumptionDecisionCommand(
  value: unknown,
  records: readonly AssumptionProposalRecord[],
  context: AssumptionLifecycleContext,
): AssumptionDecisionValidation {
  if (!isPlainObject(value)) return { accepted: false, reason: 'decision-not-object' };
  const type = value.type;
  if (type !== 'accept_assumption' && type !== 'reject_assumption' && type !== 'modify_assumption') {
    return { accepted: false, reason: 'unsupported-decision' };
  }
  if (Object.keys(value).some((key) => !decisionProperties(type).has(key))) {
    return { accepted: false, reason: 'unknown-decision-property' };
  }
  if (!boundedIdentifier(value.proposalId)
    || !finiteRevision(value.expectedStateRevision)
    || value.expectedStateRevision !== context.currentStateRevision
    || typeof value.sourceText !== 'string'
    || !value.sourceText.trim()
    || value.confidence !== 'high') {
    return { accepted: false, reason: 'invalid-decision-shape' };
  }
  const record = records.find((candidate) => candidate.proposalId === value.proposalId);
  if (!record) return { accepted: false, reason: 'unknown-proposal' };
  if (record.conversationId !== context.conversationId) {
    return { accepted: false, reason: 'cross-conversation-proposal' };
  }
  if (record.status !== 'pending') return { accepted: false, reason: 'proposal-not-pending' };
  if (type === 'modify_assumption') {
    if (!finiteAssumptionValue(value.replacementValue)) {
      return { accepted: false, reason: 'invalid-replacement-value' };
    }
    if (value.replacementUnit !== undefined && !boundedIdentifier(value.replacementUnit)) {
      return { accepted: false, reason: 'invalid-replacement-unit' };
    }
  }
  return {
    accepted: true,
    command: value as unknown as AssumptionDecisionCommand,
    record: cloneRecord(record),
  };
}

function resolvedRecord(params: {
  record: AssumptionProposalRecord;
  status: AssumptionProposalRecord['status'];
  context: AssumptionLifecycleContext;
  resolvedBy?: ProposalResolutionRef;
}): AssumptionProposalRecord {
  return {
    ...cloneRecord(params.record),
    status: params.status,
    decidedAtTurnId: params.context.turnId,
    decidedAtStateRevision: params.context.currentStateRevision + 1,
    resolvedBy: params.resolvedBy,
  };
}

export function applyAssumptionDecision(params: {
  records: readonly AssumptionProposalRecord[];
  validation: AssumptionDecisionValidation;
  context: AssumptionLifecycleContext;
}): AssumptionDecisionApplyResult {
  const cloned = params.records.map(cloneRecord);
  if (!params.validation.accepted) {
    return { records: cloned, nextStateRevision: params.context.currentStateRevision };
  }
  const { command, record } = params.validation;
  const nextRevision = params.context.currentStateRevision + 1;
  let acceptedFact: AcceptedAssumptionFact | undefined;
  let replacementProposal: AssumptionProposalRecord | undefined;
  let nextRecord: AssumptionProposalRecord;

  if (command.type === 'accept_assumption') {
    const factId = `assumption-fact:${record.proposalId}:${nextRevision}`;
    acceptedFact = {
      factId,
      proposalId: record.proposalId,
      targetRef: record.targetRef,
      slot: record.slot,
      value: record.proposedValue,
      unit: record.proposedUnit,
    };
    nextRecord = resolvedRecord({
      record,
      status: 'accepted',
      context: params.context,
      resolvedBy: { kind: 'fact', factId },
    });
  } else if (command.type === 'reject_assumption') {
    nextRecord = resolvedRecord({ record, status: 'rejected', context: params.context });
  } else {
    const replacementId = deterministicReplacementProposalId({
      proposalId: record.proposalId,
      turnId: params.context.turnId,
      stateRevision: nextRevision,
    });
    replacementProposal = {
      ...cloneRecord(record),
      proposalId: replacementId,
      proposedValue: command.replacementValue,
      proposedUnit: command.replacementUnit,
      createdAtTurnId: params.context.turnId,
      createdFromStateRevision: nextRevision,
      status: 'pending',
      decidedAtTurnId: undefined,
      decidedAtStateRevision: undefined,
      resolvedBy: undefined,
    };
    nextRecord = resolvedRecord({
      record,
      status: 'superseded',
      context: params.context,
      resolvedBy: { kind: 'proposal', proposalId: replacementId },
    });
  }

  const records = cloned.map((candidate) =>
    candidate.proposalId === record.proposalId ? nextRecord : candidate,
  );
  if (replacementProposal) records.push(replacementProposal);

  return {
    records,
    acceptedFact,
    replacementProposal,
    nextStateRevision: nextRevision,
  };
}

function targetRef(target: CorrectionTarget): string {
  switch (target.kind) {
    case 'task': return target.taskRef;
    case 'planning_range': return 'planning-range:current';
    case 'constraint': return target.constraintRef;
    case 'priority': return 'priority:current';
    case 'accepted_fact': return target.factRef;
    case 'proposal': return target.proposalId;
  }
}

function targetIndex(ref: string, prefix: string): number | null {
  const match = new RegExp(`^${prefix}:(\\d+)$`).exec(ref);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function correctionShapeValid(envelope: CorrectionEnvelope): string | null {
  if (!boundedIdentifier(envelope.correctionId)
    || !boundedIdentifier(envelope.conversationId)
    || !finiteRevision(envelope.expectedStateRevision)
    || !boundedIdentifier(envelope.sourceText)) {
    return 'invalid-correction-envelope';
  }
  if (envelope.operation === 'replace' && !envelope.replacementCommand) {
    return 'replace-requires-command';
  }
  if (envelope.operation !== 'replace' && envelope.replacementCommand) {
    return 'replacement-not-allowed';
  }
  return null;
}

function replacementCompatible(target: CorrectionTarget, command: ParsedWeeklyPlanningCommand): boolean {
  switch (target.kind) {
    case 'task': return command.type === 'set_study_goal';
    case 'planning_range': return command.type === 'set_planning_range';
    case 'constraint':
      return command.type === 'add_unavailable'
        || command.type === 'add_fixed_event'
        || command.type === 'update_life_constraint';
    case 'priority': return command.type === 'set_priority_policy';
    case 'proposal': return false;
    case 'accepted_fact': return false;
  }
}

function resolveCorrectionTarget(
  state: PlanningIntakeState,
  records: readonly AssumptionProposalRecord[],
  target: CorrectionTarget,
): boolean {
  switch (target.kind) {
    case 'task': {
      const index = targetIndex(target.taskRef, 'task');
      return index !== null && Boolean(state.tasks[index]);
    }
    case 'planning_range': return target.rangeRef === 'current' && Boolean(state.range);
    case 'constraint': {
      const index = targetIndex(target.constraintRef, 'constraint');
      return index !== null && Boolean(state.constraints[index]);
    }
    case 'priority': return target.priorityRef === 'current';
    case 'proposal': return records.some((record) => record.proposalId === target.proposalId);
    case 'accepted_fact': return false;
  }
}

function applyCorrectionToState(
  state: PlanningIntakeState,
  envelope: CorrectionEnvelope,
): PlanningIntakeState {
  const replacement = envelope.replacementCommand;
  switch (envelope.target.kind) {
    case 'task': {
      const index = targetIndex(envelope.target.taskRef, 'task') as number;
      const withoutTarget = { ...state, tasks: state.tasks.filter((_, itemIndex) => itemIndex !== index) };
      return replacement ? applyWeeklyPlanningCommands(withoutTarget, [replacement]) : withoutTarget;
    }
    case 'planning_range': {
      const withoutTarget = { ...state, range: undefined };
      return replacement ? applyWeeklyPlanningCommands(withoutTarget, [replacement]) : withoutTarget;
    }
    case 'constraint': {
      const index = targetIndex(envelope.target.constraintRef, 'constraint') as number;
      const withoutTarget = {
        ...state,
        constraints: state.constraints.filter((_, itemIndex) => itemIndex !== index),
      };
      return replacement ? applyWeeklyPlanningCommands(withoutTarget, [replacement]) : withoutTarget;
    }
    case 'priority': {
      const withoutTarget: PlanningIntakeState = {
        ...state,
        priorityPolicy: { kind: 'unknown' },
      };
      return replacement ? applyWeeklyPlanningCommands(withoutTarget, [replacement]) : withoutTarget;
    }
    case 'proposal':
    case 'accepted_fact':
      return state;
  }
}

function resolveRelatedProposals(params: {
  records: readonly AssumptionProposalRecord[];
  envelope: CorrectionEnvelope;
  context: AssumptionLifecycleContext;
}): AssumptionProposalRecord[] {
  const ref = targetRef(params.envelope.target);
  const explicitReplacement = params.envelope.operation === 'replace';
  return params.records.map((record) => {
    if (record.status !== 'pending') return cloneRecord(record);
    const related = record.targetRef === ref || record.sourceFactRefs.includes(ref);
    if (!related) return cloneRecord(record);
    return resolvedRecord({
      record,
      status: explicitReplacement ? 'superseded' : 'expired',
      context: params.context,
      resolvedBy: { kind: 'correction', correctionId: params.envelope.correctionId },
    });
  });
}

export function applyCorrectionEnvelopes(params: {
  state: PlanningIntakeState;
  records: readonly AssumptionProposalRecord[];
  envelopes: readonly CorrectionEnvelope[];
  context: AssumptionLifecycleContext;
  validateReplacementCommand?: (command: ParsedWeeklyPlanningCommand) => boolean;
}): CorrectionBatchResult {
  let state: PlanningIntakeState = {
    ...params.state,
    tasks: params.state.tasks.map((task) => ({ ...task })),
    constraints: params.state.constraints.map((constraint) => ({ ...constraint })),
    sourceTurns: [...params.state.sourceTurns],
  };
  let records = params.records.map(cloneRecord);
  const accepted: CorrectionEnvelope[] = [];
  const rejected: Array<{ envelope: CorrectionEnvelope; reason: string }> = [];

  params.envelopes.forEach((envelope) => {
    const shapeError = correctionShapeValid(envelope);
    if (shapeError) {
      rejected.push({ envelope, reason: shapeError });
      return;
    }
    if (envelope.conversationId !== params.context.conversationId) {
      rejected.push({ envelope, reason: 'cross-conversation-correction' });
      return;
    }
    if (envelope.expectedStateRevision !== params.context.currentStateRevision) {
      rejected.push({ envelope, reason: 'stale-correction' });
      return;
    }
    if (!resolveCorrectionTarget(state, records, envelope.target)) {
      rejected.push({ envelope, reason: 'unknown-or-private-target' });
      return;
    }
    if (envelope.operation === 'restore') {
      rejected.push({ envelope, reason: 'restore-target-not-recoverable' });
      return;
    }
    if (envelope.replacementCommand
      && (!replacementCompatible(envelope.target, envelope.replacementCommand)
        || (params.validateReplacementCommand && !params.validateReplacementCommand(envelope.replacementCommand)))) {
      rejected.push({ envelope, reason: 'invalid-replacement-command' });
      return;
    }

    state = applyCorrectionToState(state, envelope);
    records = resolveRelatedProposals({ records, envelope, context: params.context });
    if (envelope.target.kind === 'proposal') {
      const proposalId = envelope.target.proposalId;
      records = records.map((record) =>
        record.proposalId === proposalId && record.status === 'pending'
          ? resolvedRecord({
              record,
              status: envelope.operation === 'supersede' ? 'superseded' : 'expired',
              context: params.context,
              resolvedBy: { kind: 'correction', correctionId: envelope.correctionId },
            })
          : record,
      );
    }
    accepted.push(envelope);
  });

  const previewStale = accepted.length > 0;
  const nextStateRevision = previewStale
    ? params.context.currentStateRevision + 1
    : params.context.currentStateRevision;
  if (previewStale) {
    state = {
      ...state,
      sourceTurns: [...state.sourceTurns, accepted.map((item) => item.sourceText).join(' / ')],
      draftGenerationIntent: 'not_requested',
      draftGenerationAuthorizedAtRevision: undefined,
    };
  }

  return { state, records, accepted, rejected, previewStale, nextStateRevision };
}

export function markAssistantSuggested(state: PlanningIntakeState): PlanningIntakeState {
  if (state.draftGenerationIntent === 'user_authorized') return state;
  return {
    ...state,
    draftGenerationIntent: 'assistant_suggested',
    draftGenerationAuthorizedAtRevision: undefined,
  };
}
