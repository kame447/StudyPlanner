import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { createWeeklyPlanningStableV5DialogueProjection } from '../semantic/weeklyPlanningStableV5DialogueProjection';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import type { HeldQuestionPurposeV5 } from '../semantic/weeklyPlanningAnswerPurposeGuardV5';
import { questionIntentForStableV5Dialogue, questionTargetForStableV5Dialogue } from './weeklyPlanningStableV5DialogueContext';

/**
 * The purpose of the pending question AS THE RENDERER WAS TOLD (Issue #488 P3 S1 v2): derived from the very typed intent
 * `questionIntentForStableV5Dialogue` produced for the renderer (one derivation, no second heuristic), from the pending
 * question, the graph and the registered materials. `current_progress` is held if and only if that intent asks for current
 * progress (mode `existing_target_progress`, bounded or unbounded). Registered-material target scope, task identity and the
 * work_breakdown clarification hold nothing: there the AI decides whether to ask about progress or about the plan.
 */
export function heldQuestionPurposeFromRendererIntentV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  pendingQuestion: { questionCode: string; targetFactId: string | null; effortMeasurement?: string | null } | null | undefined;
  registeredMaterials: unknown;
}): { purpose: HeldQuestionPurposeV5; ownerTaskId: string } | null {
  const pending = params.pendingQuestion;
  if (!pending?.targetFactId || pending.questionCode !== 'missing_schedulable_work') return null;
  const planningInformation: Record<string, unknown> = {
    ...createWeeklyPlanningStableV5DialogueProjection(params.graph),
    registeredMaterials: Array.isArray(params.registeredMaterials) ? params.registeredMaterials : [],
  };
  const questionTarget = questionTargetForStableV5Dialogue({ planningInformation, targetFactId: pending.targetFactId });
  const intent = questionIntentForStableV5Dialogue({
    questionCode: pending.questionCode,
    questionTarget,
    planningInformation,
    effortMeasurement: pending.effortMeasurement ?? null,
  });
  if (intent?.kind !== 'schedulable_work_detail'
    || !(intent.requestedInformation as readonly string[]).includes('current_progress')) return null;
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(params.graph);
  const ownerTaskId = active.tasks.find((task) => task.id === pending.targetFactId)?.id
    ?? active.components.find((component) => component.id === pending.targetFactId)?.taskId ?? null;
  return ownerTaskId ? { purpose: 'current_progress', ownerTaskId } : null;
}
