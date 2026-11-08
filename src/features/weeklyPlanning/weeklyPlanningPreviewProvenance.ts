import type { WeeklyPlanningCandidateEstimateV1 } from './personalization/weeklyPlanningEstimateCalibration';
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
  /** Compact estimate: the rest of the plan's estimate metadata is derived from this candidate when its block is built. */
  estimate?: WeeklyPlanningCandidateEstimateV1;
}
