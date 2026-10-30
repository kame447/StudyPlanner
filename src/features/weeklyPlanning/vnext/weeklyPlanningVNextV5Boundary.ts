// The one audited seam through which the experimental VNext core (#926) reads
// Stable V5 contracts: the Fact Graph shape it keeps (and its lifecycle), the
// session envelope its checkpoint extends (read-only for migration), and the deterministic preview
// scheduler it hands projected work to. Read-only; VNext never writes V5 state,
// preview, trace or storage, and no production module imports VNext.
export {
  createEmptyWeeklyPlanningFactGraphV5,
  type EffortEstimateFactV5,
  type TemporalConstraintFactV5,
  type WeeklyPlanningFactDiffV5,
  type WeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactKindV5,
  type WorkloadFactV5,
} from '../semantic/weeklyPlanningFactGraphV5';
export {
  parseWeeklyPlanningStableV5PersistedSession,
  WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION,
} from '../application/weeklyPlanningStableV5SessionCodec';
export { scheduleWeeklyPlanningStableV5Preview } from '../semantic/weeklyPlanningStableV5PlacementEngine';
