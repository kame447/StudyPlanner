import { userLabelForSlot } from '../intake/weeklyPlanningQuestionSlots';
import type { WeeklyPlanningDialogueDecision } from './weeklyPlanningDialogueManager';

function formatMinutes(minutes: number | undefined): string | null {
  if (typeof minutes !== 'number') {
    return null;
  }

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;

  if (hours > 0 && restMinutes > 0) {
    return `${hours}時間${restMinutes}分`;
  }

  if (hours > 0) {
    return `${hours}時間`;
  }

  return `${restMinutes}分`;
}

function formatQuestionSlot(slotKey: string): string {
  return userLabelForSlot(slotKey) ?? slotKey;
}

function formatRequiredFields(fields: string[] | undefined): string {
  const resolved = (fields ?? []).map(formatQuestionSlot);

  return resolved.length > 0 ? resolved.join('、') : '不足している条件';
}

function formatQuestionPlan(decision: WeeklyPlanningDialogueDecision): string {
  const plannedSlots = decision.questionPlan?.map((question) => question.targetSlot) ?? [];

  if (plannedSlots.length > 0) {
    return plannedSlots.map(formatQuestionSlot).join('、');
  }

  return formatRequiredFields(decision.requiredFields);
}

function formatAmbiguities(ambiguities: string[] | undefined): string {
  const labels: Record<string, string> = {
    field_scope: '完了済み年度がどの分野の話か',
    completion_direction: '終わった年度なのか、残っている年度なのか',
    completed_years_without_field_scope: '完了済み年度をどの分野に適用するか',
    fixed_event_uncertain: '固定予定が確定かどうか',
    unit_rate: '時間が単位あたりか、使える時間か',
  };
  const resolved = (ambiguities ?? []).map((ambiguity) => labels[ambiguity] ?? ambiguity);

  return resolved.length > 0 ? resolved.join('、') : '曖昧な条件';
}

function summarizePreviewAssumptions(
  assumptions: NonNullable<WeeklyPlanningDialogueDecision['summary']>['previewAssumptions'],
): string | null {
  if (!assumptions?.length) {
    return null;
  }

  const [primary, ...remaining] = assumptions;
  return remaining.length > 0
    ? `仮定: ${primary.description} ほか${remaining.length}件`
    : `仮定: ${primary.description}`;
}

function buildConditionSummary(decision: WeeklyPlanningDialogueDecision): string {
  const summary = decision.summary;

  if (!summary) {
    return '';
  }

  const parts = [
    summary.yearRange
      ? `対象年度: ${summary.yearRange.startYear}〜${summary.yearRange.endYear}`
      : null,
    summary.fields?.length ? `分野: ${summary.fields.join('、')}` : null,
    typeof summary.remainingWorkItemCount === 'number'
      ? `残り作業: ${summary.remainingWorkItemCount}件`
      : null,
    formatMinutes(summary.totalRequestedMinutes)
      ? `必要時間: ${formatMinutes(summary.totalRequestedMinutes)}`
      : null,
    formatMinutes(summary.totalScheduledMinutes)
      ? `配置候補: ${formatMinutes(summary.totalScheduledMinutes)}`
      : null,
    typeof summary.fixedEventCount === 'number'
      ? `固定予定: ${summary.fixedEventCount}件`
      : null,
    summary.lifeConstraintKinds?.length
      ? `生活制約: ${summary.lifeConstraintKinds.join('、')}`
      : null,
    summary.assumptions?.length
      ? `仮の前提: ${summary.assumptions.join('、')}`
      : null,
    summarizePreviewAssumptions(summary.previewAssumptions),
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? `\n\n${parts.join('\n')}` : '';
}

export function createWeeklyPlanningDialogueMessage(
  decision: WeeklyPlanningDialogueDecision,
): string {
  switch (decision.kind) {
    case 'ask_missing_info':
      return `ここまでの条件を確認しました。次に ${formatQuestionPlan(
        decision,
      )} を教えてください。`;
    case 'answer_clarification':
      return [
        decision.clarification?.explanation,
        decision.questionPlan?.length
          ? `引き続き、${formatQuestionPlan(decision)} を教えてください。`
          : null,
      ].filter((part): part is string => Boolean(part)).join('\n');
    case 'confirm_ambiguity':
      return `条件に曖昧な点があります。${formatAmbiguities(
        decision.ambiguities,
      )} を確認してください。`;
    case 'confirm_draft_conditions':
      return `仮予定候補を作る前に、集まった条件を確認してください。この段階では保存しません。${buildConditionSummary(
        decision,
      )}`;
    case 'offer_dry_run_preview': {
      const previewQuestion = decision.questionPlan?.length
        ? `あわせて、${formatQuestionPlan(decision)} を教えてください。`
        : '';
      return `現在の条件と仮定を使って未保存previewの仮予定候補を作成しました。通常予定としては保存していません。${previewQuestion}多すぎる・少なすぎる・曜日や配分を変えたい場合は教えてください。${buildConditionSummary(
        decision,
      )}`;
    }
    case 'ask_relax_constraints':
      return `条件が厳しく、すべては配置しきれません。時間帯や生活制約を緩めるか、配置できる分だけにするか教えてください。${buildConditionSummary(
        decision,
      )}`;
    case 'cannot_create_draft':
      return `条件の整合性が取れず、仮予定候補を作れませんでした。追加で条件を確認してください。${buildConditionSummary(
        decision,
      )}`;
    default: {
      const exhaustiveCheck: never = decision.kind;
      return exhaustiveCheck;
    }
  }
}