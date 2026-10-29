// The one audited seam through which the experimental VNext core (#926) reads
// Stable V5 contracts: the Fact Graph shape it keeps (and its lifecycle), and the
// session envelope version its checkpoint extends. Read-only; VNext never writes
// V5 state, preview, trace or storage, and no production module imports VNext.
export {
  createEmptyWeeklyPlanningFactGraphV5,
  type EffortEstimateFactV5,
  type TemporalConstraintFactV5,
  type WeeklyPlanningFactDiffV5,
  type WeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactKindV5,
  type WorkloadFactV5,
} from '../semantic/weeklyPlanningFactGraphV5';
export { WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION } from '../application/weeklyPlanningStableV5SessionCodec';
