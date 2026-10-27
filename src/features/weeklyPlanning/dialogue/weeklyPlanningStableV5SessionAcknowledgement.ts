import type { WeeklyPlanningStableV5DialogueRenderInput } from './weeklyPlanningStableV5DialogueContracts';

export interface WeeklyPlanningApplicationSessionAcknowledgement {
  source: 'application';
  factIds: string[];
  text: string;
}

/** Presentation of one accepted fact; never interpretation, placement or approval. */
export function applicationSessionAcknowledgement(
  input: WeeklyPlanningStableV5DialogueRenderInput,
): WeeklyPlanningApplicationSessionAcknowledgement | null {
  if (input.actionKind !== 'preview_ready' || input.previewCount < 1
    || !input.previewPromotionControlLabel || input.questionCode !== null || input.recovery
    || input.currentTurnGrounding?.mode !== 'required_before_resume'
    || input.currentTurnGrounding.hasCorrections
    || input.communication?.eventRegistration
    || input.previewConstraintSatisfaction?.some(condition => condition.status !== 'satisfied')) return null;
  const efforts = input.currentTurnGrounding.acceptedFacts.filter(fact => fact.kind === 'effort_estimate');
  if (efforts.length !== 1) return null;
  const fact = efforts[0]; const { kind, minutes, precision, targetLabels } = fact.data;
  if (kind !== 'session_duration' || typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0
    || (precision !== 'exact' && precision !== 'approximate') || !Array.isArray(targetLabels)
    || targetLabels.length !== 1 || typeof targetLabels[0] !== 'string' || !targetLabels[0].trim()
    || targetLabels[0].length > 100 || /[\r\n]/u.test(targetLabels[0])) return null;
  const tasks = input.planningInformation?.tasks;
  const activeEfforts = input.planningInformation?.effortEstimates;
  if (!Array.isArray(tasks) || tasks.length !== 1 || !tasks[0]
    || tasks[0].id !== fact.data.taskId || tasks[0].title !== targetLabels[0]
    || !Array.isArray(activeEfforts) || activeEfforts.length !== 1 || activeEfforts[0]?.id !== fact.factId) return null;
  // The composed sentence still passes the normal active-fact and full-text validators.
  return { source: 'application', factIds: [fact.factId],
    text: `「${targetLabels[0]}」は1回あたり${precision === 'approximate' ? '約' : ''}${minutes}分です。` };
}

export const APPLICATION_SESSION_BODY_INSTRUCTION =
  'applicationDecision.sessionAcknowledgementはアプリが型付き受理済みFactから生成し返信の先頭に付ける確認文です。この場合はgroundingAcknowledgement=nullとし、textには候補を確認する操作案内だけを書いてください。確認文を再掲せず、時間の長さを含めないでください。日付・開始終了時刻を示す場合も入力の根拠を守り、保存済みと述べないでください。';
