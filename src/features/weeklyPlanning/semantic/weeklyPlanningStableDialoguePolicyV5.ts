import type {
  GenericSchedulerInputCompilationResult,
  GenericSchedulerInputIssue,
} from './weeklyPlanningGenericSchedulerInput';
import type {
  WeeklyPlanningEffortMeasurementV5,
} from './weeklyPlanningEffortQuestionPolicyV5';

export const WEEKLY_PLANNING_STABLE_DIALOGUE_POLICY_VERSION_V5 =
  'weekly-planning-stable-dialogue-policy-v5' as const;

export interface WeeklyPlanningStableQuestionV5 {
  domain: GenericSchedulerInputIssue['domain'];
  code: GenericSchedulerInputIssue['code'];
  factId: string | null;
  details: Record<string, string | number | boolean | null>;
  effortMeasurement?: WeeklyPlanningEffortMeasurementV5 | null;
}

export type WeeklyPlanningStableDialogueDecisionV5 =
  | {
      policyVersion: typeof WEEKLY_PLANNING_STABLE_DIALOGUE_POLICY_VERSION_V5;
      status: 'ask_question';
      question: WeeklyPlanningStableQuestionV5;
      previewEligible: false;
    }
  | {
      policyVersion: typeof WEEKLY_PLANNING_STABLE_DIALOGUE_POLICY_VERSION_V5;
      status: 'ready_for_preview';
      question: null;
      previewEligible: true;
    }
  | {
      policyVersion: typeof WEEKLY_PLANNING_STABLE_DIALOGUE_POLICY_VERSION_V5;
      status: 'nothing_to_schedule';
      question: null;
      previewEligible: false;
    };

const DOMAIN_PRIORITY: Record<GenericSchedulerInputIssue['domain'], number> = {
  semantic_uncertainty: 0,
  planning_horizon: 1,
  availability: 2,
  commitment: 3,
  task_date_rule: 4,
  work_item: 5,
  relation: 6,
  deduplication: 7,
};

const WORK_ITEM_CODE_PRIORITY: Record<string, number> = {
  orphan_workload: 0,
  invalid_actual_range: 1,
  non_integral_discrete_amount: 2,
  quantity_role_unresolved: 3,
  ambiguous_effort_estimate: 4,
  missing_effort_estimate: 5,
  remaining_workload_skipped_for_target: 98,
  completed_workload_skipped: 99,
};

function codePriority(issue: GenericSchedulerInputIssue): number {
  if (issue.domain !== 'work_item') return 0;
  return WORK_ITEM_CODE_PRIORITY[issue.code] ?? 50;
}

function issueKey(issue: GenericSchedulerInputIssue): string {
  return [
    String(DOMAIN_PRIORITY[issue.domain]).padStart(2, '0'),
    String(codePriority(issue)).padStart(3, '0'),
    issue.domain,
    issue.code,
    issue.factId ?? '',
  ].join('|');
}

function normalizeQuestion(
  issue: GenericSchedulerInputIssue,
): WeeklyPlanningStableQuestionV5 {
  return {
    domain: issue.domain,
    code: issue.code,
    factId: issue.factId,
    details: { ...(issue.details ?? {}) },
    effortMeasurement: null,
  };
}

export function decideWeeklyPlanningStableDialogueV5(
  compilation: GenericSchedulerInputCompilationResult,
): WeeklyPlanningStableDialogueDecisionV5 {
  const blocking = compilation.issues
    .filter((issue) => issue.blocking)
    .sort((left, right) => issueKey(left).localeCompare(issueKey(right)));
  if (blocking.length > 0) {
    return {
      policyVersion: WEEKLY_PLANNING_STABLE_DIALOGUE_POLICY_VERSION_V5,
      status: 'ask_question',
      question: normalizeQuestion(blocking[0]),
      previewEligible: false,
    };
  }
  if (compilation.status === 'ready' && compilation.input) {
    return {
      policyVersion: WEEKLY_PLANNING_STABLE_DIALOGUE_POLICY_VERSION_V5,
      status: 'ready_for_preview',
      question: null,
      previewEligible: true,
    };
  }
  return {
    policyVersion: WEEKLY_PLANNING_STABLE_DIALOGUE_POLICY_VERSION_V5,
    status: 'nothing_to_schedule',
    question: null,
    previewEligible: false,
  };
}

export interface WeeklyPlanningStablePreviewAuthorizationV5 {
  authorized: boolean;
  conversationId: string;
  graphRevision: number;
}

export type WeeklyPlanningStablePreviewGateReasonV5 =
  | 'allowed'
  | 'scheduler_not_ready'
  | 'authorization_missing'
  | 'authorization_conversation_mismatch'
  | 'authorization_revision_mismatch';

export interface WeeklyPlanningStablePreviewGateResultV5 {
  allowed: boolean;
  reason: WeeklyPlanningStablePreviewGateReasonV5;
}

export function evaluateWeeklyPlanningStablePreviewGateV5(params: {
  compilation: GenericSchedulerInputCompilationResult;
  conversationId: string;
  graphRevision: number;
  authorization: WeeklyPlanningStablePreviewAuthorizationV5 | null;
}): WeeklyPlanningStablePreviewGateResultV5 {
  if (params.compilation.status !== 'ready' || !params.compilation.input) {
    return { allowed: false, reason: 'scheduler_not_ready' };
  }
  if (!params.authorization?.authorized) {
    return { allowed: false, reason: 'authorization_missing' };
  }
  if (params.authorization.conversationId !== params.conversationId) {
    return {
      allowed: false,
      reason: 'authorization_conversation_mismatch',
    };
  }
  if (params.authorization.graphRevision !== params.graphRevision
    || params.compilation.input.graphRevision !== params.graphRevision) {
    return {
      allowed: false,
      reason: 'authorization_revision_mismatch',
    };
  }
  return { allowed: true, reason: 'allowed' };
}
