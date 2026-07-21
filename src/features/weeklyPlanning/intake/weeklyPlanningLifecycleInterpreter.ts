import { validateInterpretedCandidates } from './weeklyPlanningCandidateValidator';
import type { ParsedWeeklyPlanningCommand } from './weeklyPlanningCommandTypes';
import type {
  InterpretedCommandCandidate,
  InterpreterCorrectionTargetSummary,
  InterpreterPendingAssumptionSummary,
  InterpreterStateSummary,
  WeeklyPlanningIntakeInterpreter,
  WeeklyPlanningInterpreterResult,
} from './weeklyPlanningInterpreterTypes';
import type { WeeklyPlanningIntakeContext } from './weeklyPlanningIntakeTypes';
import type { AssumptionUnit } from './weeklyPlanningAssumptionProposals';
import { orderCorrectionEnvelopes } from '../planning/weeklyPlanningCorrectionOrdering';
import type {
  AssumptionDecisionCommand,
  CorrectionEnvelope,
  CorrectionTarget,
} from '../planning/weeklyPlanningAssumptionLifecycle';

export interface LifecycleInterpreterOptions {
  interpreter: WeeklyPlanningIntakeInterpreter;
  conversationId: string;
  currentStateRevision: number;
  pendingAssumptions: InterpreterPendingAssumptionSummary[];
  correctionTargets: InterpreterCorrectionTargetSummary[];
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAssumptionUnit(value: unknown): value is AssumptionUnit {
  return typeof value === 'string' && ASSUMPTION_UNITS.has(value as AssumptionUnit);
}

function canonicalizeAssumptionDecision(params: {
  value: unknown;
  userText: string;
  proposals: readonly InterpreterPendingAssumptionSummary[];
  currentStateRevision: number;
}): AssumptionDecisionCommand | null {
  if (!isRecord(params.value)) return null;
  const value = params.value;
  const type = value.type;
  if (type !== 'accept_assumption' && type !== 'reject_assumption' && type !== 'modify_assumption') {
    return null;
  }
  if (value.confidence !== 'high' || typeof value.proposalId !== 'string') return null;
  const proposalId = value.proposalId;
  if (!params.proposals.some((proposal) => proposal.proposalId === proposalId)) return null;

  const metadata = {
    proposalId,
    expectedStateRevision: params.currentStateRevision,
    sourceText: params.userText,
    confidence: 'high' as const,
  };
  if (type === 'accept_assumption') {
    return { type: 'accept_assumption', ...metadata };
  }
  if (type === 'reject_assumption') {
    return { type: 'reject_assumption', ...metadata };
  }

  const replacementValue = value.replacementValue;
  if (typeof replacementValue !== 'string'
    && typeof replacementValue !== 'number'
    && typeof replacementValue !== 'boolean') return null;
  if (typeof replacementValue === 'number' && !Number.isFinite(replacementValue)) return null;
  const replacementUnit = value.replacementUnit;
  if (replacementUnit !== undefined && !isAssumptionUnit(replacementUnit)) return null;
  return {
    type: 'modify_assumption',
    ...metadata,
    replacementValue,
    ...(replacementUnit !== undefined ? { replacementUnit } : {}),
  };
}

function correctionTarget(summary: InterpreterCorrectionTargetSummary): CorrectionTarget | null {
  switch (summary.kind) {
    case 'task': return { kind: 'task', taskRef: summary.ref };
    case 'planning_range':
      return summary.ref === 'current' ? { kind: 'planning_range', rangeRef: 'current' } : null;
    case 'constraint': return { kind: 'constraint', constraintRef: summary.ref };
    case 'priority':
      return summary.ref === 'current' ? { kind: 'priority', priorityRef: 'current' } : null;
    case 'proposal': return { kind: 'proposal', proposalId: summary.ref };
    default: return null;
  }
}

function correctionOperationCompatible(
  operation: CorrectionEnvelope['operation'],
  target: CorrectionTarget,
): boolean {
  if (operation === 'restore') return false;
  if (operation === 'supersede') return target.kind === 'proposal';
  if (operation === 'replace') {
    return target.kind === 'task'
      || target.kind === 'planning_range'
      || target.kind === 'constraint'
      || target.kind === 'priority';
  }
  return target.kind !== 'accepted_fact';
}

function releasedSlotsForCorrection(target: CorrectionTarget): Set<string> {
  switch (target.kind) {
    case 'planning_range': return new Set(['planning_range']);
    case 'priority': return new Set(['priority_policy']);
    case 'constraint': return new Set(['fixed_events', 'life_constraints']);
    default: return new Set();
  }
}

function summaryForCorrection(
  summary: InterpreterStateSummary,
  target: CorrectionTarget,
): InterpreterStateSummary {
  const releasedSlots = releasedSlotsForCorrection(target);
  return {
    ...summary,
    confirmedSlots: summary.confirmedSlots.filter((slot) => !releasedSlots.has(slot)),
  };
}

function validateReplacementCommand(params: {
  value: unknown;
  userText: string;
  target: CorrectionTarget;
  stateSummary: InterpreterStateSummary;
  context: WeeklyPlanningIntakeContext;
}): ParsedWeeklyPlanningCommand | null {
  if (!isRecord(params.value) || params.value.confidence !== 'high') return null;
  const candidate: InterpretedCommandCandidate = {
    command: params.value as unknown as ParsedWeeklyPlanningCommand,
    origin: 'ai_interpreter',
    needsConfirmation: false,
  };
  const validation = validateInterpretedCandidates(
    [candidate],
    summaryForCorrection(params.stateSummary, params.target),
    params.context,
  );
  return validation.accepted.length === 1
    && validation.acceptedWithConfirmation.length === 0
    && validation.rejected.length === 0
    ? validation.accepted[0]
    : null;
}

function canonicalizeCorrectionEnvelope(params: {
  value: unknown;
  userText: string;
  targets: readonly InterpreterCorrectionTargetSummary[];
  conversationId: string;
  currentStateRevision: number;
  stateSummary: InterpreterStateSummary;
  context: WeeklyPlanningIntakeContext;
  index: number;
}): CorrectionEnvelope | null {
  if (!isRecord(params.value) || params.value.confidence !== 'high') return null;
  const value = params.value;
  const operation = value.operation;
  if (operation !== 'replace' && operation !== 'remove' && operation !== 'supersede') return null;
  if (typeof value.targetKind !== 'string' || typeof value.targetRef !== 'string') return null;
  const targetKind = value.targetKind;
  const targetRef = value.targetRef;
  const summary = params.targets.find((target) =>
    target.kind === targetKind && target.ref === targetRef,
  );
  if (!summary) return null;
  const target = correctionTarget(summary);
  if (!target || !correctionOperationCompatible(operation, target)) return null;

  let replacementCommand: ParsedWeeklyPlanningCommand | undefined;
  if (operation === 'replace') {
    const validated = validateReplacementCommand({
      value: value.replacementCommand,
      userText: params.userText,
      target,
      stateSummary: params.stateSummary,
      context: params.context,
    });
    if (!validated) return null;
    replacementCommand = validated;
  } else if (value.replacementCommand !== undefined) {
    return null;
  }

  return {
    correctionId: `${params.conversationId}:correction:${params.currentStateRevision}:${params.index}`,
    conversationId: params.conversationId,
    expectedStateRevision: params.currentStateRevision,
    operation,
    target,
    ...(replacementCommand ? { replacementCommand } : {}),
    sourceText: params.userText,
  };
}

export function createLifecycleAwareWeeklyPlanningInterpreter(
  options: LifecycleInterpreterOptions,
): WeeklyPlanningIntakeInterpreter {
  return {
    async interpretUserTurn(params): Promise<WeeklyPlanningInterpreterResult> {
      const stateSummary = {
        ...params.stateSummary,
        pendingAssumptionProposals: options.pendingAssumptions.map((proposal) => ({ ...proposal })),
        correctionTargets: options.correctionTargets.map((target) => ({ ...target })),
      };
      const base = await options.interpreter.interpretUserTurn({ ...params, stateSummary });
      const assumptionDecisions = (base.assumptionDecisions ?? []).flatMap((value) => {
        const decision = canonicalizeAssumptionDecision({
          value,
          userText: params.userText,
          proposals: options.pendingAssumptions,
          currentStateRevision: options.currentStateRevision,
        });
        return decision ? [decision] : [];
      });
      const correctionEnvelopes = orderCorrectionEnvelopes(
        (base.correctionEnvelopes ?? []).flatMap((value, index) => {
          const envelope = canonicalizeCorrectionEnvelope({
            value,
            userText: params.userText,
            targets: options.correctionTargets,
            conversationId: options.conversationId,
            currentStateRevision: options.currentStateRevision,
            stateSummary,
            context: params.context,
            index,
          });
          return envelope ? [envelope] : [];
        }),
      );
      return {
        ...base,
        ...(assumptionDecisions.length > 0 ? { assumptionDecisions } : { assumptionDecisions: undefined }),
        ...(correctionEnvelopes.length > 0 ? { correctionEnvelopes } : { correctionEnvelopes: undefined }),
      };
    },
  };
}
