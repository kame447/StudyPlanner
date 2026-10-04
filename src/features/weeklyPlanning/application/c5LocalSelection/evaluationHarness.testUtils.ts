import type { CandidateChoiceRequest } from '../candidateSelection/contracts';
import type { C5QuestionSnapshot } from './contracts';
import type { PlanningState } from '../../types';
import type { WeeklyPlanningFactGraphV5 } from '../../semantic/weeklyPlanningFactGraphV5';
import { serializeC5Value } from './basis';

export type C5EvaluationArm = 'flat_complete_tuple' | 'hierarchy_same_leaves' | 'luna_only';
export interface C5PairedCase {
  caseId: string;
  wholeUtterance: string;
  provenance: 'fresh_sealed_holdout' | 'calibration' | 'consumed_diagnostic' | 'synthetic_diagnostic';
  snapshot: C5QuestionSnapshot;
  planningState: PlanningState;
  graph: WeeklyPlanningFactGraphV5;
}
export interface C5MeasuredResult {
  formalOutcome: 'committed' | 'fallback' | 'rejected' | 'unknown';
  selectedCandidateId: string | null;
  /** Actual dispatch log includes retry/repair, all hierarchy heads, fallback and late work. */
  dispatches: readonly { dispatchId: string; provider: 'jev' | 'luna'; inputTokens: number | null; outputTokens: number | null; cost: number | null }[];
  semanticElapsedMs: number | null;
  closure: 'complete' | 'unknown';
}

/** Preparation only: no default runner/provider, thresholds, judge, label or measurement fabrication. */
export function prepareC5PairedEvaluation(input: C5PairedCase, order: readonly C5EvaluationArm[]) {
  if (order.length !== 3 || new Set(order).size !== 3
    || !['flat_complete_tuple', 'hierarchy_same_leaves', 'luna_only'].every((arm) => order.includes(arm as C5EvaluationArm))) throw new Error('One copy of every paired arm required.');
  const identity = serializeC5Value({ wholeUtterance: input.wholeUtterance, payload: input.snapshot.payloadSerialization });
  return order.map((arm) => ({ arm, identity, input: structuredClone(input),
    leafIdentity: serializeC5Value(input.snapshot.candidates),
    // No span pruning: both candidate arms carry all complete leaves and identical context.
    maximumChildrenPerMenu: arm === 'flat_complete_tuple' ? input.snapshot.candidates.length : 2,
  }));
}

/** Optional execution requires an explicitly supplied, independently approved runner. Not invoked by this PoC. */
export async function runC5PairedEvaluation(prepared: ReturnType<typeof prepareC5PairedEvaluation>,
  run: (arm: typeof prepared[number]) => Promise<C5MeasuredResult>) {
  const results = [];
  for (const arm of prepared) results.push({ arm: arm.arm, result: await run(structuredClone(arm)) });
  return results;
}

/** Wire-side audit: a missing whole leaf/qualifier is a semantic recall failure, never a speed win. */
export function completeC5LeavesInRequests(snapshot: C5QuestionSnapshot, requests: readonly CandidateChoiceRequest[]): boolean {
  const leaves = requests.flatMap((request) => request.menu.options.flatMap((option) =>
    option.kind === 'leaf' ? [option.candidate] : option.kind === 'group' ? [...option.candidates] : []));
  return snapshot.candidates.every((candidate) => leaves.some((leaf) => serializeC5Value(leaf) === serializeC5Value(candidate)));
}
