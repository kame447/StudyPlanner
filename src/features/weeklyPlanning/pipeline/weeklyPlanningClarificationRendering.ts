import type { AllowedDialogueAction } from '../planning/weeklyPlanningBehaviorTypes';
import type { WeeklyPlanningBehaviorAwarePipelineOutput } from './weeklyPlanningBehaviorAwareIntakePipelineCore';

function clarificationExample(targetSlot: string | undefined): string {
  switch (targetSlot) {
    case 'planning_start_date':
      return '例えば「来週の月曜日から」のように、開始したい日を答えてください。';
    case 'planning_period':
      return '例えば「来週の月曜日から日曜日まで」のように、開始日と終了日を答えてください。';
    case 'tasks_or_goals':
      return '例えば「英単語を80語と数学のワークを20ページ」のように答えてください。';
    case 'unit_rate':
    case 'unit_duration_estimate':
      return '例えば「1ページ10分くらい」のように、おおよその時間を答えてください。';
    case 'fixed_events':
      return '例えば「月曜日の18時から20時はバイトです」または「固定の予定はありません」のように答えてください。';
    case 'sleep_cycle':
      return '例えば「0時に寝て7時に起きます」のように答えてください。';
    case 'meal_bath_constraints':
      return '例えば「夕食は19時、お風呂は22時ごろです」のように答えてください。';
    case 'life_constraints':
    case 'availability_basis':
    case 'feasibility_basis':
      return '例えば「時間割を使う」または「平日は20時以降なら空いています」のように答えてください。';
    case 'constraint_relaxation':
      return '例えば「英語を優先して、数学は翌日に回す」または「長い課題を2回に分ける」のように答えてください。';
    case 'draft_generation_confirmation':
    case 'draft_confirmation':
      return '例えば「その条件で仮予定を作って」のように答えてください。';
    case 'preview_confirmation':
      return '例えば「このままで大丈夫」または「火曜日だけ直して」のように答えてください。';
    case 'ambiguity_resolution':
      return '提示された選択肢のうち、意図に近い方を答えてください。';
    case 'planning_purpose':
      return '例えば「試験勉強」または「数学の宿題」のように答えてください。';
    default:
      return '分かる範囲で、具体例を1つ挙げて答えてください。';
  }
}

function fallbackTextForAction(
  action: AllowedDialogueAction,
  output: WeeklyPlanningBehaviorAwarePipelineOutput,
): string | undefined {
  if (action.kind === 'show_options' && action.topicId === 'planning-range') {
    const label = output.state.pendingPlanningRange?.scope.label;
    return label
      ? `${label}のどの日から計画を始めますか？`
      : '計画期間は、今週・来週・週末のどれにしますか？';
  }
  if (action.kind === 'ask_required_fact' && action.topicId === 'task-identity') {
    return '具体的に何をどこまで進めたいか教えてください。';
  }
  if (action.kind === 'ask_required_fact' && action.topicId === 'workload-estimate') {
    return '取り組む量か、かかる時間の目安を教えてください。';
  }
  if (action.kind === 'show_options' && action.topicId === 'availability-basis') {
    return '使える時間は、時間割・登録済み予定を使うか、空いている時間を直接教えてください。';
  }
  if (action.kind === 'report_infeasibility') {
    return action.displayHint
      ?? '現在の条件では全てを配置できないため、優先・分割・延期のどれで調整するか選んでください。';
  }
  if (action.kind === 'suggest_draft_generation') {
    return 'この考え方で仮の予定を組んでよければ、そのように伝えてください。';
  }
  return action.displayHint;
}

export function renderResolvedClarification(
  output: WeeklyPlanningBehaviorAwarePipelineOutput,
): WeeklyPlanningBehaviorAwarePipelineOutput {
  const clarification = output.decision.clarification;
  if (output.decision.kind !== 'answer_clarification' || !clarification) return output;
  return {
    ...output,
    behaviorDialogue: {
      message: [
        clarification.explanation.trim(),
        clarificationExample(clarification.targetSlot),
      ].filter(Boolean).join('\n'),
      response: null,
      source: 'deterministic_fallback',
    },
  };
}

export function renderNormalDialogue(
  output: WeeklyPlanningBehaviorAwarePipelineOutput,
): WeeklyPlanningBehaviorAwarePipelineOutput {
  const lines = output.behavior.actions
    .filter((action) => action.kind !== 'acknowledge_fact')
    .slice(0, 2)
    .flatMap((action) => {
      const text = fallbackTextForAction(action, output);
      return text ? [text] : [];
    });
  return {
    ...output,
    behaviorDialogue: {
      message: lines.join('\n'),
      response: null,
      source: 'deterministic_fallback',
    },
  };
}
