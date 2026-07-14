import {
  applyCorrectionEnvelopes,
  type AssumptionLifecycleContext,
  type CorrectionBatchResult,
  type CorrectionEnvelope,
} from './weeklyPlanningAssumptionLifecycle';
import type { AssumptionProposalRecord } from '../intake/weeklyPlanningAssumptionProposals';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import type { ParsedWeeklyPlanningCommand } from '../intake/weeklyPlanningCommandTypes';

function taskIndex(envelope: CorrectionEnvelope): number | null {
  if (envelope.target.kind !== 'task') return null;
  const match = /^task:(\d+)$/.exec(envelope.target.taskRef);
  return match ? Number(match[1]) : null;
}

function targetKey(envelope: CorrectionEnvelope): string {
  switch (envelope.target.kind) {
    case 'task': return `0:${envelope.target.taskRef}`;
    case 'planning_range': return '1:current';
    case 'constraint': return `2:${envelope.target.constraintRef}`;
    case 'priority': return '3:current';
    case 'accepted_fact': return `4:${envelope.target.factRef}`;
    case 'proposal': return `5:${envelope.target.proposalId}`;
  }
}

export function orderCorrectionEnvelopes(
  envelopes: readonly CorrectionEnvelope[],
): CorrectionEnvelope[] {
  return [...envelopes].sort((left, right) => {
    const leftTask = taskIndex(left);
    const rightTask = taskIndex(right);
    if (leftTask !== null && rightTask !== null && leftTask !== rightTask) {
      return rightTask - leftTask;
    }
    const targetDifference = targetKey(left).localeCompare(targetKey(right));
    if (targetDifference !== 0) return targetDifference;
    return left.correctionId.localeCompare(right.correctionId);
  });
}

export function applyOrderedCorrectionEnvelopes(params: {
  state: PlanningIntakeState;
  records: readonly AssumptionProposalRecord[];
  envelopes: readonly CorrectionEnvelope[];
  context: AssumptionLifecycleContext;
  validateReplacementCommand?: (command: ParsedWeeklyPlanningCommand) => boolean;
}): CorrectionBatchResult {
  return applyCorrectionEnvelopes({
    ...params,
    envelopes: orderCorrectionEnvelopes(params.envelopes),
  });
}
