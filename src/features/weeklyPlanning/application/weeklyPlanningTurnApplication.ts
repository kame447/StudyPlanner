// Stable V5 composition of the turn application. VNext imports the Core module instead, so this
// file (and the V5 runtime executor behind the gateway) stays out of VNext-only production bundles.
import { weeklyPlanningTurnRuntimeGateway } from './weeklyPlanningTurnRuntimeGateway';
import {
  weeklyPlanningTurnApplicationBaseServices, submitWeeklyPlanningApplicationTurnWithServices,
  type SubmitWeeklyPlanningApplicationTurnParams, type WeeklyPlanningTurnApplicationServices,
} from './weeklyPlanningTurnApplicationCore';

export type { SubmitWeeklyPlanningApplicationTurnParams, WeeklyPlanningTurnApplicationServices };

export const weeklyPlanningTurnApplicationServices: WeeklyPlanningTurnApplicationServices = {
  ...weeklyPlanningTurnApplicationBaseServices,
  runtimeGateway: weeklyPlanningTurnRuntimeGateway,
};

export function submitWeeklyPlanningApplicationTurn(
  params: SubmitWeeklyPlanningApplicationTurnParams,
  services: WeeklyPlanningTurnApplicationServices = weeklyPlanningTurnApplicationServices,
) {
  return submitWeeklyPlanningApplicationTurnWithServices(params, services);
}
