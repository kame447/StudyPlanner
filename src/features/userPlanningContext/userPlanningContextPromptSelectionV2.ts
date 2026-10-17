import { loadUserPlanningContextSnapshotV1 } from './userPlanningContextSpace';
import { selectUserPlanningContextPromptRecordsV2, type UserPlanningContextPromptRecordV2 } from './userPlanningContextPromptSelectionV2Core';
import { semanticMemoryAccess } from './semanticMemory/semanticMemoryOptIn';
import { semanticMemoryApplication } from './semanticMemory/index/semanticMemoryApplication';
import { selectHybridUserPlanningContextPromptRecords } from './semanticMemory/index/semanticMemoryHybrid';
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

/** Optional asynchronous entry; existing synchronous consumers keep their lexical contract. */
export async function userPlanningContextPromptSelectionHybridV2(params:
  Parameters<typeof userPlanningContextPromptSelectionV2>[0] & { query: string; signal?: AbortSignal },
): Promise<UserPlanningContextPromptRecordV2[]> {
  if (import.meta.env.VITE_SEMANTIC_MEMORY_ENABLED !== 'true' || await semanticMemoryAccess(params.ownerId)) {
    return userPlanningContextPromptSelectionV2(params);
  }
  if (!semanticMemoryApplication.canonical(params.ownerId)) return userPlanningContextPromptSelectionV2(params);
  try {
    const semantic = await semanticMemoryApplication.recall(params.ownerId, params.query, params.signal);
    if (!semanticMemoryApplication.canonical(params.ownerId)) return [];
    if (semantic.status !== 'ok') return userPlanningContextPromptSelectionV2(params);
    const hybrid = await selectHybridUserPlanningContextPromptRecords({ ownerId: params.ownerId,
      getCanonicalView: () => {
        const view = semanticMemoryApplication.canonical(params.ownerId);
        if (!view) throw new Error('canonical owner scope expired');
        return view;
      }, semantic, relevantScopeKeys: params.relevantScopeKeys, enabled: true });
    if (!semanticMemoryApplication.canonical(params.ownerId)) return [];
    const access = await semanticMemoryAccess(params.ownerId);
    if (!semanticMemoryApplication.canonical(params.ownerId)) return [];
    return access ? userPlanningContextPromptSelectionV2(params) : hybrid;
  } catch {
    return semanticMemoryApplication.canonical(params.ownerId) ? userPlanningContextPromptSelectionV2(params) : [];
  }
}
