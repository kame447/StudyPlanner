import { loadUserPlanningContextSnapshotV1 } from './userPlanningContextSpace';
import { selectUserPlanningContextPromptRecordsV2, type UserPlanningContextPromptRecordV2 } from './userPlanningContextPromptSelectionV2Core';
export * from './userPlanningContextPromptSelectionV2Core';

export function userPlanningContextPromptSelectionV2(params: {
  ownerId: string;
  currentDate: string;
  relevantScopeKeys?: readonly string[];
}): UserPlanningContextPromptRecordV2[] {
  const snapshot = loadUserPlanningContextSnapshotV1({
    ownerId: params.ownerId,
    currentDate: params.currentDate,
  });
  return selectUserPlanningContextPromptRecordsV2({
    records: snapshot.records,
    relevantScopeKeys: params.relevantScopeKeys,
  });
}
