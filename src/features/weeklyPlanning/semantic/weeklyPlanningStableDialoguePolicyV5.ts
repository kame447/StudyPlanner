import type {
  GenericSchedulerInputCompilationResult,
  GenericSchedulerInputIssue,
} from './weeklyPlanningGenericSchedulerInput';

export const WEEKLY_PLANNING_STABLE_DIALOGUE_POLICY_VERSION_V5 =
  'weekly-planning-stable-dialogue-policy-v5' as const;

export interface WeeklyPlanningStableQuestionV5 {
  domain: GenericSchedulerInputIssue['domain'];
  code: GenericSchedulerInputIssue['code'];
  factId: string | null;
  details: Record<string, string | number | boolean | null>;
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

function issueKey(issue: GenericSchedulerInputIssue): string {
  return [
    String(DOMAIN_PRIORITY[issue.domain]).padStart(2, '0'),
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
