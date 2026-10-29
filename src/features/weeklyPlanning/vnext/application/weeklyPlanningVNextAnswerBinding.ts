// Binds an answer to the question the user is actually looking at. The existing
// presentation binding (planning-state revision, latest assistant message, graph
// revision) stays the outer freshness check; inside it, the presented VNext
// question must still be one the current projection asks. Answers become ordinary
// typed deltas; the caller applies them as a turn and re-projects.
import type { WeeklyPlanningQuestionPresentationFreshness } from '../../intake/weeklyPlanningQuestionPresentation';
import type {
  VNextQuestion,
  VNextTurnDelta,
  WeeklyPlanningVNextProjection,
} from '../weeklyPlanningVNextTypes';

/** What was shown with the assistant message, stored inside the presentation record. */
export interface WeeklyPlanningVNextPresentedQuestion {
  questionKey: string;
  graphRevision: number;
}

export type WeeklyPlanningVNextAnswer =
  /** A typed UI choice or a focused short answer resolved to one presented option. */
  | { kind: 'option'; optionId: string }
  /** A total in minutes for the asked work; the binder names the work by identity, not the AI. */
  | { kind: 'estimate_minutes'; minutes: number; taskFactId: string }
  /** A semantic reading of a longer answer, already a typed delta. */
  | { kind: 'delta'; delta: VNextTurnDelta };

export type WeeklyPlanningVNextAnswerBinding =
  | { status: 'bound'; question: VNextQuestion; delta: VNextTurnDelta }
  /** Stale or changed: show the current question again, never apply old options. */
  | { status: 'represent'; question: VNextQuestion | null }
  /** The answer does not address the presented question; handle it as a normal turn. */
  | { status: 'not_an_answer' };

const EMPTY_DELTA: VNextTurnDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };

function referencedFactIds(delta: VNextTurnDelta): string[] {
  const refs = [
    ...delta.patch.map((patch) => patch.targetFactId),
    ...delta.remove.map((removal) => removal.targetFactId),
    ...delta.relate.flatMap((relation) => [relation.a, relation.b])
      .flatMap((ref) => ('factId' in ref ? [ref.factId] : [])),
    ...delta.add.flatMap((fact) => ('targetRef' in fact && 'factId' in fact.targetRef ? [fact.targetRef.factId] : [])),
  ];
  return refs;
}

export function bindWeeklyPlanningVNextAnswer(params: {
  freshness: WeeklyPlanningQuestionPresentationFreshness;
  presented: WeeklyPlanningVNextPresentedQuestion | null;
  projection: WeeklyPlanningVNextProjection;
  /** Active fact id of each subject lineage, from the current state. */
  leafOf: (lineageId: string) => string | null;
  answer: WeeklyPlanningVNextAnswer;
}): WeeklyPlanningVNextAnswerBinding {
  const current = params.projection.questions[0] ?? null;
  if (params.freshness.status !== 'fresh' || !params.presented
    || params.presented.graphRevision !== params.projection.graphRevision) {
    return { status: 'represent', question: current };
  }
  const question = params.projection.questions.find((candidate) => candidate.key === params.presented!.questionKey);
  if (!question) return { status: 'represent', question: current };

  const answer = params.answer;
  if (answer.kind === 'option') {
    const option = question.options.find((candidate) => candidate.optionId === answer.optionId);
    return option ? { status: 'bound', question, delta: option.delta } : { status: 'represent', question };
  }
  if (answer.kind === 'estimate_minutes') {
    if (question.code !== 'missing_effort_estimate' || !question.forWork
      || !Number.isFinite(answer.minutes) || answer.minutes <= 0) {
      return { status: 'represent', question };
    }
    return {
      status: 'bound',
      question,
      delta: {
        ...EMPTY_DELTA,
        add: [{
          kind: 'effort_estimate',
          localId: 'answer_estimate',
          taskRef: { factId: answer.taskFactId },
          targetRef: { workLineageId: question.forWork.workLineageId },
          effortKind: 'total_duration',
          minutes: answer.minutes,
          unitCode: null,
          unitLabel: null,
          precision: 'exact',
        }],
      },
    };
  }
  const subjects = new Set(question.subjectLineageIds.flatMap((lineageId) => {
    const leaf = params.leafOf(lineageId);
    return leaf ? [leaf] : [];
  }));
  if (question.forWork) subjects.add(question.forWork.definingFactId);
  return referencedFactIds(answer.delta).some((id) => subjects.has(id))
    ? { status: 'bound', question, delta: answer.delta }
    : { status: 'not_an_answer' };
}
