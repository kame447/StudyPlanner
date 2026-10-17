import {
  projectUserPlanningContextScopeV2,
  selectUserPlanningContextPromptRecordsV2,
  type UserPlanningContextPromptRecordV2,
} from '../../userPlanningContextPromptSelectionV2Core';
import type { SemanticMemoryCanonicalView, SemanticMemoryRecallResult } from '../semanticMemoryContract';
import { revalidateSemanticMemoryCandidates } from './semanticMemoryIndex';

/** Only appends bounded scoped records; baseline ordering, core and authority are untouched. */
export async function selectHybridUserPlanningContextPromptRecords(params: {
  ownerId: string;
  getCanonicalView: () => SemanticMemoryCanonicalView;
  relevantScopeKeys?: readonly string[];
  semantic: SemanticMemoryRecallResult;
  enabled: boolean;
  maxAdditions?: number;
}): Promise<UserPlanningContextPromptRecordV2[]> {
  const view = params.getCanonicalView();
  if (view.ownerId !== params.ownerId) return [];
  const baseline = selectUserPlanningContextPromptRecordsV2({ records: view.records,
    relevantScopeKeys: params.relevantScopeKeys });
  if (!params.enabled || params.semantic.status !== 'ok') return baseline;
  try {
    const valid = await revalidateSemanticMemoryCandidates(params.ownerId, params.semantic.candidates, view);
    const latest = params.getCanonicalView();
    if (latest.ownerId !== params.ownerId) return [];
    if (latest.ownerId !== view.ownerId || latest.revision !== view.revision
      || JSON.stringify(latest.records) !== JSON.stringify(view.records)) {
      return selectUserPlanningContextPromptRecordsV2({ records: latest.records,
        relevantScopeKeys: params.relevantScopeKeys });
    }
    const selected = new Set(baseline.map((record) => record.id));
    const current = new Map(view.records.map((record) => [record.id, record]));
    const max = params.maxAdditions === undefined || !Number.isFinite(params.maxAdditions)
      ? 3 : Math.max(0, Math.min(5, Math.floor(params.maxAdditions)));
    const additions: UserPlanningContextPromptRecordV2[] = [];
    for (const candidate of valid) {
      const record = current.get(candidate.recordId);
      if (additions.length >= max) break;
      if (!record || selected.has(record.id)) continue;
      const scope = projectUserPlanningContextScopeV2(record);
      if (scope.type === 'global') continue;
      selected.add(record.id);
      additions.push({ id: record.id, kind: record.kind, label: record.label, value: record.value,
        dateExpression: record.dateExpression, status: record.status, origin: record.origin,
        scope, relevanceTier: 'relevant' });
    }
    return [...baseline, ...additions];
  } catch { return baseline; }
}
