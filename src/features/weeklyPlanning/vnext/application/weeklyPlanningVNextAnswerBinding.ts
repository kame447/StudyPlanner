// Binds an answer to the question the user is actually looking at. Whether the
// presentation is still the one shown with the latest assistant message is the
// caller's check (the existing presentation binding, or the session that stores
// the presented question with its reply); inside it, the presented VNext
// question must still be one the current projection asks. Answers become ordinary
// typed deltas; the caller applies them as a turn and re-projects.
import type {
  VNextFactRef,
  VNextQuestion,
  VNextTurnDelta,
  VNextTurnError,
  VNextWorkRef,
  WeeklyPlanningVNextGraph,
  WeeklyPlanningVNextProjection,
} from '../weeklyPlanningVNextTypes';
import { createVNextLineageResolver } from '../weeklyPlanningVNextWorkIdentity';
import type { WeeklyPlanningVNextInterpretedAnswer } from '../weeklyPlanningVNextInterpretationContract';

/** What was shown with the assistant message, stored inside the presentation record. */
export interface WeeklyPlanningVNextPresentedQuestion {
  questionKey: string;
  graphRevision: number;
}

export type WeeklyPlanningVNextAnswer =
  | Extract<WeeklyPlanningVNextInterpretedAnswer, { kind: 'proposal_decision' | 'session_minutes' }>
  /** A typed UI choice or a focused short answer resolved to one presented option. */
  | { kind: 'option'; optionId: string }
  /**
   * Minutes for the asked work, for the whole of it or per unit; the binder names the task,
   * the work and (per unit) the work's unit from the question, not the AI.
   */
  | { kind: 'estimate_minutes'; minutes: number; per: 'whole_work' | 'unit'; precision?: 'exact' | 'approximate' | 'unspecified' }
  /** A semantic reading of a longer answer, already a typed delta. */
  | { kind: 'delta'; delta: VNextTurnDelta };

export type WeeklyPlanningVNextAnswerBinding =
  | { status: 'bound'; question: VNextQuestion; delta: VNextTurnDelta }
  /** Stale or changed: show the current question again, never apply old options. */
  | { status: 'represent'; question: VNextQuestion | null }
  /** The answer does not address the presented question; handle it as a normal turn. */
  | { status: 'not_an_answer' };

const EMPTY_DELTA: VNextTurnDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };

/** Lineages a delta addresses: facts by their lineage, projected work by its identity. */
function addressedLineages(delta: VNextTurnDelta, lineageOf: (factId: string) => string): Set<string> {
  const ref = (value: { factId: string } | { localId: string } | { workLineageId: string }) =>
    ('factId' in value ? [lineageOf(value.factId)] : 'workLineageId' in value ? [value.workLineageId] : []);
  return new Set([
    ...delta.patch.map((patch) => lineageOf(patch.targetFactId)),
    ...delta.remove.map((removal) => lineageOf(removal.targetFactId)),
    ...delta.relate.flatMap((relation) => [...ref(relation.a), ...ref(relation.b)]),
    ...delta.add.flatMap((fact) => ('targetRef' in fact ? ref(fact.targetRef) : [])),
  ]);
}

export function bindWeeklyPlanningVNextAnswer(params: {
  /** The presented question is the one shown with the latest assistant message. */
  presentationFresh: boolean;
  presented: WeeklyPlanningVNextPresentedQuestion | null;
  projection: WeeklyPlanningVNextProjection;
  /** Lineage of a fact id, from the current state. */
  lineageOf: (factId: string) => string;
  answer: WeeklyPlanningVNextAnswer;
  /** Corrections the same reading states; the turn applies them with the answer. */
  sameTurnPatches?: VNextTurnDelta['patch'];
}): WeeklyPlanningVNextAnswerBinding {
  const current = params.projection.questions[0] ?? null;
  if (!params.presentationFresh || !params.presented
    || params.presented.graphRevision !== params.projection.graphRevision) {
    return { status: 'represent', question: current };
  }
  const question = params.projection.questions.find((candidate) => candidate.key === params.presented!.questionKey);
  if (!question) return { status: 'represent', question: current };

  const answer = params.answer;
  if (answer.kind === 'proposal_decision') {
    if (question.code !== 'learning_strategy_proposal' || question.proposal?.id !== answer.proposalId
      || question.proposal.status !== 'pending') return { status: 'represent', question };
    return { status: 'bound', question, delta: { ...EMPTY_DELTA,
      proposalDecision: { proposalId: answer.proposalId, decision: answer.decision, questionKey: question.key } } };
  }
  if (answer.kind === 'session_minutes') {
    if (question.code !== 'missing_effort_estimate' || question.effortMeasurement !== 'session_duration' || !question.forWork
      || !Number.isFinite(answer.minutes) || answer.minutes <= 0) return { status: 'represent', question };
    return { status: 'bound', question, delta: { ...EMPTY_DELTA, add: [{ kind: 'effort_estimate', localId: 'answer_session',
      taskRef: { factId: question.taskId }, targetRef: { factId: question.forWork.definingFactId }, effortKind: 'session_duration',
      minutes: answer.minutes, unitCode: null, unitLabel: null, precision: 'exact' }] } };
  }
  if (answer.kind === 'option') {
    const option = question.options.find((candidate) => candidate.optionId === answer.optionId);
    return option ? { status: 'bound', question, delta: option.delta } : { status: 'represent', question };
  }
  if (answer.kind === 'estimate_minutes') {
    if (question.code !== 'missing_effort_estimate' || question.effortMeasurement === 'session_duration' || !question.forWork
      || !Number.isFinite(answer.minutes) || answer.minutes <= 0) {
      return { status: 'represent', question };
    }
    // A per-unit answer is in the asked work's unit as this turn leaves it: when the same reading corrects
    // that unit, the rate is per the corrected unit, which is what the transaction measures it against
    // (structure audit SA03). Fields the correction leaves null keep their value, as a patch does.
    const forWork = question.forWork;
    const correction = params.sameTurnPatches?.find((patch) => patch.kind === 'workload'
      && params.lineageOf(patch.targetFactId) === params.lineageOf(forWork.definingFactId));
    const unitChanges = correction?.kind === 'workload' ? correction.changes : null;
    return {
      status: 'bound',
      question,
      delta: {
        ...EMPTY_DELTA,
        add: [{
          kind: 'effort_estimate',
          localId: 'answer_estimate',
          taskRef: { factId: question.taskId },
          ...(answer.per === 'whole_work'
            ? { targetRef: { workLineageId: forWork.workLineageId }, effortKind: 'total_duration' as const,
                unitCode: null, unitLabel: null }
            : { targetRef: { factId: forWork.definingFactId }, effortKind: 'duration_per_unit' as const,
                unitCode: unitChanges?.unitCode ?? forWork.unitCode, unitLabel: unitChanges?.unitLabel ?? forWork.unitLabel }),
          minutes: answer.minutes,
          precision: answer.precision ?? 'exact',
        }],
      },
    };
  }
  const subjects = new Set(question.subjectLineageIds);
  if (question.forWork) {
    subjects.add(question.forWork.workLineageId);
    subjects.add(params.lineageOf(question.forWork.definingFactId));
  }
  return [...addressedLineages(answer.delta, params.lineageOf)].some((lineage) => subjects.has(lineage))
    ? { status: 'bound', question, delta: answer.delta }
    : { status: 'not_an_answer' };
}

function mergeDeltas(left: VNextTurnDelta, right: VNextTurnDelta): VNextTurnDelta {
  return {
    ...(left.proposalDecision ? { proposalDecision: left.proposalDecision } : {}),
    add: [...left.add, ...right.add],
    patch: [...left.patch, ...right.patch],
    remove: [...left.remove, ...right.remove],
    relate: [...left.relate, ...right.relate],
    defer: [...left.defer, ...right.defer],
  };
}

/**
 * Estimates a reading's delta states about the asked work. An estimate answer is the turn's
 * statement of that work's estimate; the same reading stating it again as a fact would commit
 * two copies of one statement (Astra F02). Decided by lineage identity only.
 */
function restatedAskedEstimates(question: VNextQuestion, delta: VNextTurnDelta, graph: WeeklyPlanningVNextGraph): VNextTurnError[] {
  if (!question.forWork) return [];
  const { lineageOf } = createVNextLineageResolver(graph);
  const asked = new Set([question.forWork.workLineageId, lineageOf(question.forWork.definingFactId),
    lineageOf(question.componentId ?? question.taskId)]);
  const aboutAsked = (ref: VNextFactRef | VNextWorkRef) => ('workLineageId' in ref ? asked.has(ref.workLineageId)
    : 'factId' in ref && asked.has(lineageOf(ref.factId)));
  const errors: VNextTurnError[] = [];
  delta.add.forEach((fact, index) => {
    if (fact.kind === 'effort_estimate' && aboutAsked(fact.targetRef)) {
      errors.push({ code: 'invalid_value', path: `add[${index}]`, localId: fact.localId, factId: null });
    }
  });
  delta.patch.forEach((patch, index) => {
    const effort = patch.kind === 'effort_estimate' ? graph.effortEstimates.find((fact) => fact.id === patch.targetFactId) : undefined;
    if (effort && aboutAsked({ factId: effort.targetFactId })) {
      errors.push({ code: 'invalid_value', path: `patch[${index}]`, localId: patch.localId, factId: patch.targetFactId });
    }
  });
  return errors;
}

/**
 * Reading items that state a bound option's change again. The option is the turn's statement
 * of that change; the same reading patching or removing a fact the option changes, or relating
 * the option's pair, would change one fact twice. Decided by lineage identity only.
 */
function restatedOptionChange(option: VNextTurnDelta, delta: VNextTurnDelta, graph: WeeklyPlanningVNextGraph): VNextTurnError[] {
  const { lineageOf } = createVNextLineageResolver(graph);
  const changed = new Set([...option.patch, ...option.remove].map((item) => lineageOf(item.targetFactId)));
  const pair = (relation: VNextTurnDelta['relate'][number]) => ('factId' in relation.a && 'factId' in relation.b
    ? [lineageOf(relation.a.factId), lineageOf(relation.b.factId)].sort().join('|') : null);
  const pairs = new Set(option.relate.map(pair));
  return [
    ...delta.patch.map((item, index) => ({ item, path: `patch[${index}]`, localId: item.localId, factId: item.targetFactId })),
    ...delta.remove.map((item, index) => ({ item, path: `remove[${index}]`, localId: null, factId: item.targetFactId })),
  ].filter(({ factId }) => changed.has(lineageOf(factId)))
    .map(({ path, localId, factId }): VNextTurnError => ({ code: 'invalid_value', path, localId, factId }))
    .concat(delta.relate.flatMap((relation, index) => (pairs.has(pair(relation))
      ? [{ code: 'invalid_value' as const, path: `relate[${index}]`, localId: null, factId: null }] : [])));
}

/**
 * What one interpreted turn applies: the reading's delta, plus the bound answer
 * to the presented question when the words answer it. An answer that no longer
 * binds re-presents the current question and applies nothing; an answer restated
 * as a fact in the same reading is a conflict, never two commits. The
 * session, the provider's validation and every evaluation harness use this one function.
 * Do not add a second place that merges an answer into a delta: the provider's dry run and the
 * session must apply the same thing. Tests: ExperimentalSession integration "…restated as a fact in
 * the same reading is one statement…" (estimate, Astra F02; option).
 */
export function resolveWeeklyPlanningVNextTurnDelta(params: {
  presentationFresh: boolean;
  presented: WeeklyPlanningVNextPresentedQuestion | null;
  projection: WeeklyPlanningVNextProjection;
  graph: WeeklyPlanningVNextGraph;
  interpreted: { delta: VNextTurnDelta; answer: WeeklyPlanningVNextInterpretedAnswer | null };
}): { status: 'delta'; delta: VNextTurnDelta }
  | { status: 'represent'; question: VNextQuestion | null }
  | { status: 'conflict'; errors: VNextTurnError[] } {
  const answer = params.interpreted.answer;
  if (!answer) return { status: 'delta', delta: params.interpreted.delta };
  const binding = bindWeeklyPlanningVNextAnswer({ ...params, lineageOf: createVNextLineageResolver(params.graph).lineageOf, answer,
    sameTurnPatches: params.interpreted.delta.patch });
  if (binding.status !== 'bound') {
    return { status: 'represent', question: binding.status === 'represent' ? binding.question : params.projection.questions[0] ?? null };
  }
  const restated = answer.kind === 'estimate_minutes' || answer.kind === 'session_minutes'
    ? restatedAskedEstimates(binding.question, params.interpreted.delta, params.graph)
    : restatedOptionChange(binding.delta, params.interpreted.delta, params.graph);
  if (restated.length) return { status: 'conflict', errors: restated };
  return { status: 'delta', delta: mergeDeltas(binding.delta, params.interpreted.delta) };
}
