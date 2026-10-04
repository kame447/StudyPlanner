import { freezeCandidateValue } from './canonical';
import type { CalibratedChoicePolicy, CandidateChoiceRequest, CandidateTuple, SelectionFailure } from './contracts';

const nonempty = (value: unknown) => typeof value === 'string' && value.length > 0;
const probability = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).length === expected.length && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));

export function snapshotCalibratedChoicePolicy(policy: CalibratedChoicePolicy): CalibratedChoicePolicy {
  const snapshot = freezeCandidateValue(policy) as unknown as CalibratedChoicePolicy;
  if (!record(snapshot) || !exact(snapshot, ['id', 'calibrationEvidenceId', 'rules'])
    || !nonempty(snapshot.id) || !nonempty(snapshot.calibrationEvidenceId)
    || !Array.isArray(snapshot.rules) || snapshot.rules.length === 0
    || snapshot.rules.some((rule) => !record(rule) || !exact(rule, ['menuKind', 'optionCount', 'depth', 'minimumTopProbability', 'minimumMargin'])
      || (rule.menuKind !== 'leaves' && rule.menuKind !== 'groups')
      || typeof rule.optionCount !== 'number' || !Number.isSafeInteger(rule.optionCount) || rule.optionCount < 2 || rule.optionCount > 255
      || typeof rule.depth !== 'number' || !Number.isSafeInteger(rule.depth) || rule.depth < 0
      || !probability(rule.minimumTopProbability) || !probability(rule.minimumMargin))
    || new Set(snapshot.rules.map((rule) => `${rule.menuKind}:${rule.optionCount}:${rule.depth}`)).size !== snapshot.rules.length) {
    throw new Error('An explicit calibrated policy is required.');
  }
  return snapshot;
}

export function hasCalibratedMenu<T extends CandidateTuple>(request: CandidateChoiceRequest<T>, policy: CalibratedChoicePolicy): boolean {
  return policy.rules.some((entry) => entry.menuKind === request.menu.kind && entry.depth === request.menu.depth && entry.optionCount === request.menu.options.length);
}

/** Strict normalized distribution and correlation, not a provider-generated confidence field. */
export function gateCandidateChoice<T extends CandidateTuple>(params: {
  request: CandidateChoiceRequest<T>;
  response: unknown;
  policy: CalibratedChoicePolicy;
}): { status: 'selected'; optionId: string } | { status: 'rejected'; reason: SelectionFailure } {
  const reject = (reason: SelectionFailure) => ({ status: 'rejected' as const, reason });
  const { request, policy } = params;
  let response: unknown;
  try { response = freezeCandidateValue(params.response); }
  catch { return reject('invalid_response'); }
  const rule = policy.rules.find((entry) => entry.menuKind === request.menu.kind && entry.depth === request.menu.depth && entry.optionCount === request.menu.options.length);
  if (!rule) return reject('uncalibrated_menu');
  if (!record(response) || !exact(response, ['nodeId', 'requestId', 'selectionEpoch', 'candidateSetHash', 'semanticSufficiency', 'optionId', 'probabilities'])
    || response.nodeId !== request.menu.nodeId || response.requestId !== request.requestId
    || response.selectionEpoch !== request.selectionEpoch || response.candidateSetHash !== request.candidateSetHash
    || !Array.isArray(response.probabilities)) return reject('invalid_response');
  if (response.semanticSufficiency !== 'only_candidate_meaning') return reject('extra_meaning');
  const optionIds = request.menu.options.map((option) => option.id);
  if (!optionIds.includes(response.optionId as string) || response.probabilities.length !== optionIds.length) return reject('invalid_response');
  const distribution: { optionId: string; probability: number }[] = [];
  for (const entry of response.probabilities) {
    if (!record(entry) || !exact(entry, ['optionId', 'probability']) || typeof entry.optionId !== 'string'
      || !optionIds.includes(entry.optionId) || !probability(entry.probability)
      || distribution.some((previous) => previous.optionId === entry.optionId)) return reject('invalid_response');
    distribution.push({ optionId: entry.optionId, probability: entry.probability });
  }
  if (Math.abs(distribution.reduce((total, entry) => total + entry.probability, 0) - 1) > 1e-6) return reject('invalid_response');
  distribution.sort((left, right) => right.probability - left.probability);
  const [top, second] = distribution;
  // Ties always abstain even if a caller supplied a zero margin.
  if (!second || top.probability === second.probability || top.optionId !== response.optionId) return reject('invalid_response');
  if (top.optionId === 'none') return reject('none');
  if (top.probability < rule.minimumTopProbability || top.probability - second.probability < rule.minimumMargin) return reject('low_probability');
  return { status: 'selected', optionId: top.optionId };
}
