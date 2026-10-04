/** Provider-neutral wire contract. Application owns leaves, binding and all mutation authority. */
export type ChoiceValue = null | boolean | number | string | readonly ChoiceValue[] | ChoiceTuple;
export interface ChoiceTuple { readonly [key: string]: ChoiceValue }
export interface CandidateChoiceWireRequest {
  readonly wholeUtterance: string;
  readonly requestId: string;
  readonly selectionEpoch: number;
  readonly candidateSetHash: string;
  /** Research evidence only; spans never prune leaves or establish semantic truth. */
  readonly uninterpretedSpans?: readonly { readonly start: number; readonly end: number }[];
  readonly context: {
    readonly question: { readonly id: string; readonly code: string };
    readonly target: { readonly kind: string; readonly id: string };
    readonly scope: ChoiceTuple;
  };
  readonly menu: {
    readonly nodeId: string;
    readonly depth: number;
    readonly kind: 'leaves' | 'groups';
    readonly options: readonly (
      | { readonly kind: 'none'; readonly id: 'none' }
      | { readonly kind: 'leaf'; readonly id: string; readonly candidate: ChoiceCandidate }
      | { readonly kind: 'group'; readonly id: string; readonly candidates: readonly ChoiceCandidate[] }
    )[];
  };
}
export interface ChoiceCandidate { readonly id: string; readonly label: string; readonly tuple: ChoiceTuple }
export interface CandidateChoiceDecisionContext {
  readonly purpose: 'candidate_choice';
  readonly request: CandidateChoiceWireRequest;
}
export const CANDIDATE_CHOICE_CATALOG_VERSION = 'complete-candidate-choice-2026-10-05-v1';
export const CANDIDATE_CHOICE_QUESTION_CODES = ['missing_effort_estimate', 'ambiguous_effort_estimate', 'quantity_role_unresolved', 'missing_time_bounds', 'invalid_time_interval', 'named_time_period_unresolved'] as const;
export interface CandidateChoiceEvaluation {
  readonly status: 'evaluated';
  readonly catalogVersion: typeof CANDIDATE_CHOICE_CATALOG_VERSION;
  readonly requestId: string;
  readonly selectionEpoch: number;
  readonly candidateSetHash: string;
  readonly nodeId: string;
  readonly optionId: string;
  readonly probabilities: readonly { readonly optionId: string; readonly probability: number }[];
  /** Raw auxiliary scores; only an explicitly calibrated application policy can interpret them. */
  readonly conditionChange: number;
  readonly independentMeaning: number;
}
export type CandidateChoiceResult = CandidateChoiceEvaluation | { readonly status: 'unavailable'; readonly reason: string };

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const exact = (v: Record<string, unknown>, fields: readonly string[]) => Object.keys(v).length === fields.length && fields.every(k => Object.prototype.hasOwnProperty.call(v, k));
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 160;
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const probability = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
function jsonValue(v: unknown, depth = 0): boolean {
  if (depth > 12) return false;
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.length <= 254 && v.every(x => jsonValue(x, depth + 1));
  return record(v) && Object.keys(v).length <= 64 && Object.entries(v).every(([k, x]) => !['__proto__', 'constructor', 'prototype'].includes(k) && jsonValue(x, depth + 1));
}
function candidate(v: unknown): v is ChoiceCandidate {
  return record(v) && exact(v, ['id', 'label', 'tuple']) && text(v.id)
    && typeof v.label === 'string' && v.label.trim().length > 0 && v.label.length <= 1000
    && record(v.tuple) && jsonValue(v.tuple);
}
export function isCandidateChoiceDecisionContext(v: unknown): v is CandidateChoiceDecisionContext {
  if (!record(v) || !exact(v, ['purpose', 'request']) || v.purpose !== 'candidate_choice') return false;
  const r = v.request;
  if (!record(r) || !exact(r, ['wholeUtterance', 'requestId', 'selectionEpoch', 'candidateSetHash', 'context', 'menu', ...(r.uninterpretedSpans === undefined ? [] : ['uninterpretedSpans'])])
    || !text(r.requestId) || !integer(r.selectionEpoch)
    || typeof r.candidateSetHash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(r.candidateSetHash)
    || typeof r.wholeUtterance !== 'string' || !r.wholeUtterance.trim() || new TextEncoder().encode(r.wholeUtterance).length > 8000) return false;
  if (r.uninterpretedSpans !== undefined && (!Array.isArray(r.uninterpretedSpans) || r.uninterpretedSpans.length > 32
    || r.uninterpretedSpans.some(s => !record(s) || !exact(s, ['start', 'end']) || !integer(s.start) || !integer(s.end) || s.end <= s.start || s.end > (r.wholeUtterance as string).length))) return false;
  const c = r.context;
  if (!record(c) || !exact(c, ['question', 'target', 'scope'])
    || !record(c.question) || !exact(c.question, ['id', 'code']) || !text(c.question.id) || !text(c.question.code) || !(CANDIDATE_CHOICE_QUESTION_CODES as readonly string[]).includes(c.question.code)
    || !record(c.target) || !exact(c.target, ['kind', 'id']) || !text(c.target.kind) || !text(c.target.id)
    || !record(c.scope) || !jsonValue(c.scope)) return false;
  const m = r.menu;
  if (!record(m) || !exact(m, ['nodeId', 'depth', 'kind', 'options']) || !text(m.nodeId) || !integer(m.depth) || m.depth > 16
    || !['leaves', 'groups'].includes(String(m.kind)) || !Array.isArray(m.options) || m.options.length < 2 || m.options.length > 255) return false;
  const ids = new Set<string>(); const leaves = new Set<string>(); let none = 0;
  for (const o of m.options) {
    if (!record(o) || !text(o.id) || ids.has(o.id)) return false;
    ids.add(o.id);
    if (o.kind === 'none') { if (!exact(o, ['kind', 'id']) || o.id !== 'none') return false; none++; continue; }
    if (o.id === 'none') return false;
    let candidates: ChoiceCandidate[];
    if (o.kind === 'leaf' && m.kind === 'leaves' && exact(o, ['kind', 'id', 'candidate']) && candidate(o.candidate)) candidates = [o.candidate];
    else if (o.kind === 'group' && m.kind === 'groups' && exact(o, ['kind', 'id', 'candidates'])
      && Array.isArray(o.candidates) && o.candidates.length > 0 && o.candidates.length <= 254 && o.candidates.every(candidate)) candidates = o.candidates;
    else return false;
    for (const leaf of candidates) { if (leaves.has(leaf.id)) return false; leaves.add(leaf.id); }
  }
  if (none !== 1 || leaves.size > 254) return false;
  try { return new TextEncoder().encode(JSON.stringify(v)).length <= 240_000; } catch { return false; }
}

export function isCandidateChoiceEvaluation(v: unknown, r: CandidateChoiceWireRequest): v is CandidateChoiceEvaluation {
  if (!record(v) || !exact(v, ['status', 'catalogVersion', 'requestId', 'selectionEpoch', 'candidateSetHash', 'nodeId', 'optionId', 'probabilities', 'conditionChange', 'independentMeaning'])
    || v.status !== 'evaluated' || v.catalogVersion !== CANDIDATE_CHOICE_CATALOG_VERSION
    || v.requestId !== r.requestId || v.selectionEpoch !== r.selectionEpoch || v.candidateSetHash !== r.candidateSetHash || v.nodeId !== r.menu.nodeId
    || !probability(v.conditionChange) || !probability(v.independentMeaning)
    || !Array.isArray(v.probabilities) || v.probabilities.length !== r.menu.options.length) return false;
  const ids = new Set<string>(); let sum = 0; let selected = -1; let maximum = -1;
  for (const p of v.probabilities) {
    if (!record(p) || !exact(p, ['optionId', 'probability']) || typeof p.optionId !== 'string'
      || ids.has(p.optionId) || !r.menu.options.some(o => o.id === p.optionId) || !probability(p.probability)) return false;
    ids.add(p.optionId); sum += p.probability; maximum = Math.max(maximum, p.probability);
    if (p.optionId === v.optionId) selected = p.probability;
  }
  return Math.abs(sum - 1) <= 1e-6 && selected >= 0 && selected === maximum;
}
