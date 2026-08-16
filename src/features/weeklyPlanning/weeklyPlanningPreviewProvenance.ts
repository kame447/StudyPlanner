import type {
  PlanType,
  WeeklyPlanningMemoryPaceObservationSourceV1,
} from '../../types/domain';

export interface WeeklyPlanningStableV5PreviewProvenance {
  runtime: 'stable_v5';
  conversationId: string;
  graphRevision: number;
  taskId: string;
  sourceFactRefs: string[];
  planType: PlanType;
  sessionRole?: 'learning' | 'review';
  reviewRound?: 1 | 2;
  weeklyPlanningObservationSource?: WeeklyPlanningMemoryPaceObservationSourceV1;
}
