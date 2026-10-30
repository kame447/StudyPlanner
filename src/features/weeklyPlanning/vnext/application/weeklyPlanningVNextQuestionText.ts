// What the user is shown for a VNext question: the question text and, for a
// question answered by one of its options, one label per option. The session
// shows exactly this text, and the option-choice route offers exactly these
// labels, so a free-text reply is judged against what was displayed.
import type { VNextQuestion, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import { computeVNextWorkUnits, createVNextLineageResolver } from '../weeklyPlanningVNextWorkIdentity';

export interface WeeklyPlanningVNextQuestionPresentation {
  text: string;
  optionLabels: Record<string, string>;
}

export function presentWeeklyPlanningVNextQuestion(
  state: WeeklyPlanningVNextState,
  question: VNextQuestion,
): WeeklyPlanningVNextQuestionPresentation {
  const { graph } = state;
  const resolver = createVNextLineageResolver(graph);
  const factOf = (factId: string) => graph.workloads.find((workload) => workload.id === resolver.leafOf(factId));
  const title = graph.tasks.find((task) => task.id === (resolver.leafOf(question.taskId) ?? question.taskId))?.title ?? '';
  const owner = computeVNextWorkUnits(graph).find((candidate) => candidate.ownerKey === question.ownerKey);
  const unitOfWork = (lineageId: string) => owner?.units.find((unit) => unit.workLineageId === lineageId);
  const amountOf = (lineageId: string) => {
    const unit = unitOfWork(lineageId);
    return unit ? `${unit.amount}${unit.workload.unitLabel}` : '';
  };

  const issue = owner?.issue?.code === 'remaining_inconsistent' ? owner.issue : null;
  const remainingUnit = issue ? factOf(issue.remainingFactId)?.unitLabel ?? '' : '';
  const optionLabels = Object.fromEntries(question.options.map((option) => {
    const label = option.optionId === 'remaining_follows_progress' ? `残りを${option.value}${remainingUnit}にする`
      : option.optionId === 'completed_follows_remaining' ? `終わった量を${option.value}${remainingUnit}にする`
        : option.optionId === 'distinct' ? '別々の作業として両方やる'
          : option.optionId === 'same' ? '同じ作業としてまとめる'
            : option.optionId.startsWith('keep:') ? `${amountOf(option.optionId.slice('keep:'.length))}の方だけにする`
              : option.optionId;
    return [option.optionId, label];
  }));
  const choices = question.options.length ? `（${question.options.map((option) => optionLabels[option.optionId]).join(' / ')}）` : '';

  let text: string;
  if (question.code === 'missing_schedulable_work') {
    text = `「${title}」は、どれくらいやりますか？（時間や量）`;
  } else if (question.code === 'missing_effort_estimate' && question.forWork) {
    text = `「${title}」の${question.forWork.amount}は、全部で何分くらいかかりそうですか？`;
  } else if (issue) {
    text = `「${title}」の残りの量が、全体${issue.totalAmount}${remainingUnit}と終わった${issue.totalAmount - issue.derivedAmount}${remainingUnit}`
      + `から計算した${issue.derivedAmount}${remainingUnit}と合いません（残りは${issue.statedAmount}${remainingUnit}と伺いました）。どちらに合わせますか？${choices}`;
  } else if (question.code === 'same_or_distinct_work') {
    text = `「${title}」の${question.subjectLineageIds.map(amountOf).join('と')}は、同じ作業ですか？${choices}`;
  } else {
    const values = question.options.map((option) => option.value).join(' / ');
    text = `「${title}」について確認させてください（${question.code}${values ? `: ${values}` : ''}）。`;
  }
  return { text, optionLabels };
}
