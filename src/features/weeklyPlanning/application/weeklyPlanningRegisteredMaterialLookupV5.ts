import { plannerRepository } from '../../../repositories';
import {
  clearWeeklyPlanningRegisteredMaterialRuntimeV5,
  getWeeklyPlanningRegisteredMaterialSummariesV5,
  setWeeklyPlanningRegisteredMaterialRuntimeV5,
  type WeeklyPlanningRegisteredMaterialSummaryV5,
} from '../semantic/weeklyPlanningRegisteredMaterialContextV5';

export async function refreshWeeklyPlanningRegisteredMaterialsV5(
  ownerId: string,
): Promise<WeeklyPlanningRegisteredMaterialSummaryV5[]> {
  try {
    const materials = await plannerRepository.getStudyMaterials(ownerId);
    setWeeklyPlanningRegisteredMaterialRuntimeV5({ ownerId, materials });
    return getWeeklyPlanningRegisteredMaterialSummariesV5(ownerId);
  } catch {
    clearWeeklyPlanningRegisteredMaterialRuntimeV5(ownerId);
    return [];
  }
}
