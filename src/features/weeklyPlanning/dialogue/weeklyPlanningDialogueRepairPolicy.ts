import type {
  MissingResolutionOpportunity,
  PlanningHypothesisSnapshot,
} from '../planning/weeklyPlanningBehaviorTypes';

export type DialogueRepairMode =
  | 'explicit_repair'
  | 'pass_over'
  | 'continue';

export type ExplicitRepairForm =
  | 'clarification'
  | 'proposal_confirmation'
  | 'direct_question';

export interface DialogueRepairPolicy {
  mode: DialogueRepairMode;
  targetTopicId?: string;
  repairForm?: ExplicitRepairForm;
  deferredTopicIds: string[];
  reason:
    | 'clarification_requested'
    | 'blocking_uncertainty'
    | 'grounded_high_impact_uncertainty'
    | 'non_blocking_uncertainty'
    | 'no_repair_needed';
}

export interface GroundedAcceptedFacts {
  taskLabels: string[];
  planningPeriodLabel?: string;
  constraintSummary: string[];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function repairFormForOpportunity(
  opportunity: MissingResolutionOpportunity,
): ExplicitRepairForm {
  if (opportunity.mode === 'propose_default' || opportunity.mode === 'offer_options') {
    return 'proposal_confirmation';
  }
  return 'direct_question';
}

function selectBlockingOpportunity(
  snapshot: PlanningHypothesisSnapshot,
): MissingResolutionOpportunity | undefined {
  const blocking = new Set(snapshot.readiness.blockingDimensions);
  return snapshot.resolutionOpportunities.find((opportunity) =>
    blocking.has(opportunity.dimension)
    && opportunity.mode !== 'derive_deterministically',
  );
}

function selectGroundedHighImpactOpportunity(
  snapshot: PlanningHypothesisSnapshot,
): MissingResolutionOpportunity | undefined {
  return snapshot.resolutionOpportunities.find((opportunity) =>
    opportunity.impact === 'high'
    && opportunity.uncertainty === 'high'
    && opportunity.sourceFactRefs.length > 0,
  );
}

export function decideDialogueRepairPolicy(params: {
  snapshot: PlanningHypothesisSnapshot;
  clarificationTopicId?: string;
}): DialogueRepairPolicy {
  if (params.clarificationTopicId) {
    return {
      mode: 'explicit_repair',
      targetTopicId: params.clarificationTopicId,
      repairForm: 'clarification',
      deferredTopicIds: [],
      reason: 'clarification_requested',
    };
  }

  const blockingOpportunity = selectBlockingOpportunity(params.snapshot);
  if (blockingOpportunity) {
    return {
      mode: 'explicit_repair',
      targetTopicId: blockingOpportunity.topicId,
      repairForm: repairFormForOpportunity(blockingOpportunity),
      deferredTopicIds: params.snapshot.resolutionOpportunities
        .filter((opportunity) => opportunity.topicId !== blockingOpportunity.topicId)
        .map((opportunity) => opportunity.topicId),
      reason: 'blocking_uncertainty',
    };
  }

  const groundedHighImpact = selectGroundedHighImpactOpportunity(params.snapshot);
  if (groundedHighImpact) {
    return {
      mode: 'explicit_repair',
      targetTopicId: groundedHighImpact.topicId,
      repairForm: repairFormForOpportunity(groundedHighImpact),
      deferredTopicIds: params.snapshot.resolutionOpportunities
        .filter((opportunity) => opportunity.topicId !== groundedHighImpact.topicId)
        .map((opportunity) => opportunity.topicId),
      reason: 'grounded_high_impact_uncertainty',
    };
  }

  const deferredTopicIds = unique(
    params.snapshot.resolutionOpportunities
      .filter((opportunity) => opportunity.mode !== 'derive_deterministically')
      .map((opportunity) => opportunity.topicId),
  );
  if (deferredTopicIds.length > 0) {
    return {
      mode: 'pass_over',
      deferredTopicIds,
      reason: 'non_blocking_uncertainty',
    };
  }

  return {
    mode: 'continue',
    deferredTopicIds: [],
    reason: 'no_repair_needed',
  };
}

function latestUserText(
  recentConversation: Array<{ role: 'user' | 'assistant'; content: string }> | undefined,
): string {
  return [...(recentConversation ?? [])]
    .reverse()
    .find((turn) => turn.role === 'user')
    ?.content.trim() ?? '';
}

function constraintKindLabel(summary: string): string | undefined {
  const kind = summary.trim().split(/\s+/)[0];
  switch (kind) {
    case 'meal': return '食事';
    case 'bath': return 'お風呂';
    case 'sleep': return '睡眠';
    case 'commute': return '移動';
    case 'fixed_event': return '固定予定';
    case 'unavailable': return '予定を入れない時間';
    case 'buffer': return '予定前後の余裕';
    case 'cram_school': return '塾';
    case 'club': return '部活動';
    default: return undefined;
  }
}

function constraintMentionedInText(summary: string, text: string): boolean {
  const kind = summary.trim().split(/\s+/)[0];
  const patterns: Record<string, RegExp> = {
    meal: /食事|夕食|昼食|朝食|ご飯|晩ごはん|晩御飯/,
    bath: /風呂|入浴|シャワー/,
    sleep: /睡眠|寝る|就寝|起きる|起床/,
    commute: /移動|通学|通勤|帰宅|家に着/,
    fixed_event: /固定予定|予定|授業|バイト|仕事|通院|ゼミ/,
    unavailable: /空いていない|入れない|予定を入れたくない/,
    buffer: /余裕|準備|前後|バッファ/,
    cram_school: /塾/,
    club: /部活|部活動|サークル/,
  };
  if (patterns[kind]?.test(text)) return true;

  const times = summary.match(/\d{1,2}:\d{2}/g) ?? [];
  return times.some((time) => {
    const [hour, minute] = time.split(':');
    return text.includes(time)
      || text.includes(`${Number(hour)}時${Number(minute) === 0 ? '' : `${Number(minute)}分`}`);
  });
}

function formatConstraintSummary(summary: string): string {
  const label = constraintKindLabel(summary);
  if (!label) return summary.trim();

  const date = summary.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  const times = summary.match(/\d{1,2}:\d{2}/g) ?? [];
  const timeLabel = times.length >= 2
    ? `${times[0]}〜${times[1]}`
    : times[0];
  return [date, label, timeLabel].filter(Boolean).join(' ');
}

export function deriveGroundedAcknowledgementSummaries(params: {
  acceptedFacts: GroundedAcceptedFacts;
  recentConversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
}): string[] {
  const text = latestUserText(params.recentConversation);
  if (!text) return [];

  const summaries: string[] = [];
  const planningPeriod = params.acceptedFacts.planningPeriodLabel;
  if (
    planningPeriod
    && (text.includes(planningPeriod) || /今週|来週|週末|土日|今日から/.test(text))
  ) {
    summaries.push(`計画期間は${planningPeriod}`);
  }

  const mentionedTasks = params.acceptedFacts.taskLabels.filter((label) =>
    label.trim().length > 0 && text.includes(label.trim()),
  );
  if (mentionedTasks.length > 0) {
    summaries.push(`学習内容は${mentionedTasks.map((label) => `「${label}」`).join('と')}`);
  }

  for (const summary of params.acceptedFacts.constraintSummary) {
    if (constraintMentionedInText(summary, text)) {
      summaries.push(formatConstraintSummary(summary));
    }
  }

  return unique(summaries).slice(0, 3);
}

export function renderGroundedAcknowledgement(
  summaries: readonly string[],
): string | undefined {
  const grounded = unique([...summaries]);
  if (grounded.length === 0) return undefined;
  if (grounded.length === 1) return `${grounded[0]}と確認しました。`;
  return `${grounded.join('、')}として受け取りました。`;
}

export function isAcknowledgementGrounded(params: {
  acknowledgement: string | undefined;
  acceptedFacts: GroundedAcceptedFacts;
}): boolean {
  const text = params.acknowledgement?.trim();
  if (!text) return false;
  if (params.acceptedFacts.taskLabels.some((label) => label && text.includes(label))) return true;
  if (
    params.acceptedFacts.planningPeriodLabel
    && text.includes(params.acceptedFacts.planningPeriodLabel)
  ) return true;
  return params.acceptedFacts.constraintSummary.some((summary) => {
    const label = constraintKindLabel(summary);
    const times = summary.match(/\d{1,2}:\d{2}/g) ?? [];
    return Boolean(label && text.includes(label)) || times.some((time) => text.includes(time));
  });
}
