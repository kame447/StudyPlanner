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
  const labels: Record<string, string> = {
    planning_start_date: '計画の開始日',
    tasks_or_goals: '学習内容や目標',
    fixed_events: '授業・バイト・病院・ゼミなどの固定予定の有無',
    sleep_cycle: '睡眠時間',
    meal_bath_constraints: '食事・風呂などの生活制約',
    life_constraints: '食事・風呂・睡眠などの生活制約',
    year_range: '対象年度',
    progress: '現在の進捗',
    completion_direction: '完了済み年度の範囲',
    unit_rate: '1年分または1単位あたりの目安時間',
    priority_policy: '分野や年度の優先順',
  };

  return labels[slotKey] ?? slotKey;
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
    case 'offer_dry_run_preview':
      return `仮予定候補を未保存previewとして表示しました。通常予定としては保存していません。${buildConditionSummary(
        decision,
      )}`;
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