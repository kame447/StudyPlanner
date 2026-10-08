import type { WeeklyPlanningSemanticNormalizerRunV5 } from './weeklyPlanningSemanticNormalizerRunV5';
import { conversationArchitecturePolicy } from '../weeklyPlanningConversationArchitecture';

const consumedRepairs = new WeakSet<WeeklyPlanningSemanticNormalizerRunV5>();

export function markWeeklyPlanningSemanticRepairConsumedV5(run: WeeklyPlanningSemanticNormalizerRunV5): void {
  // Preserve legacy retry behavior; the interaction policy owns this ledger.
  if (!conversationArchitecturePolicy(run.input.conversationArchitecture).semanticConversationActs) return;
  consumedRepairs.add(run);
}

export function weeklyPlanningSemanticRepairConsumedV5(run: WeeklyPlanningSemanticNormalizerRunV5): boolean {
  return consumedRepairs.has(run);
}
