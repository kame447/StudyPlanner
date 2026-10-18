import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  projectUserPlanningContextScopeV2,
  selectUserPlanningContextPromptRecordsV2,
  userPlanningContextPromptSelectionV2,
  userPlanningContextPromptSelectionHybridV2,
} from './userPlanningContextPromptSelectionV2';
import * as space from './userPlanningContextSpace';
import { semanticMemoryApplication } from './semanticMemory/index/semanticMemoryApplication';
import { semanticMemoryRecordFingerprint } from './semanticMemory/index/semanticMemoryFingerprint';
import type { UserPlanningContextRecordV1 } from './userPlanningContextTypes';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function record(
  id: string,
  kind: UserPlanningContextRecordV1['kind'],
  label: string,
  status: UserPlanningContextRecordV1['status'] = 'active',
): UserPlanningContextRecordV1 {
  return {
    id,
    ownerId: 'owner-1',
    kind,
    label,
    value: kind === 'concern' ? '苦手' : '内容',
    dateExpression: null,
    observedDate: '2026-08-29',
    resolvedDate: null,
    sourceText: `${label}について覚える`,
    sourceConversationId: 'conversation-1',
    sourceTurnId: `turn-${id}`,
    recordedAt: `2026-08-29T00:00:${id.padStart(2, '0')}.000Z`,
    status,
    origin: 'user_confirmed',
  };
}

describe('user planning context prompt selection v2', () => {
  it('projects compatibility kinds into user-facing scope classes without raw-text routing', () => {
    expect(projectUserPlanningContextScopeV2(record('1', 'study_goal', '第一志望'))).toEqual({
      type: 'global',
      key: null,
    });
    expect(projectUserPlanningContextScopeV2(record('2', 'concern', '数学'))).toEqual({
      type: 'subject',
      key: '数学',
    });
    expect(projectUserPlanningContextScopeV2(record('3', 'learning_preference', '暗記'))).toEqual({
      type: 'activity_kind',
      key: '暗記',
    });
  });

  it('keeps core context, prioritizes exact structured scope matches, and does not send every active record', () => {
    const records = [
      record('1', 'study_goal', '第一志望'),
      record('2', 'concern', '数学'),
      record('3', 'concern', '英語'),
      ...Array.from({ length: 12 }, (_, index) =>
        record(String(index + 4), 'concern', `分野${index + 1}`)),
      record('99', 'concern', '削除済み', 'revoked'),
    ];

    const selected = selectUserPlanningContextPromptRecordsV2({
      records,
      relevantScopeKeys: ['数学'],
    });

    expect(selected[0]).toMatchObject({
      id: '1',
      relevanceTier: 'core',
      scope: { type: 'global', key: null },
    });
    expect(selected.some((item) => item.id === '2')).toBe(true);
    expect(selected.find((item) => item.id === '2')).toMatchObject({
      relevanceTier: 'relevant',
      scope: { type: 'subject', key: '数学' },
    });
    expect(selected.some((item) => item.id === '99')).toBe(false);
    expect(selected.length).toBeLessThan(records.filter((item) => item.status === 'active').length);
  });
});

describe('optional async hybrid facade (existing sync facade unchanged)', () => {
  const params = { ownerId: 'owner-1', currentDate: '2026-10-17', query: '計算について' };
  function snapshot() {
    const records = Array.from({ length: 8 }, (_, index) => record(String(index), 'concern', `分野${index}`));
    vi.spyOn(space, 'loadUserPlanningContextSnapshotV1').mockReturnValue({
      version: 'studyplanner-user-planning-context-v1', ownerId: 'owner-1', records, updatedAt: '' });
    return records;
  }
  it('flag off is byte-identical and never touches Worker, IndexedDB or recall', async () => {
    snapshot(); vi.stubEnv('VITE_SEMANTIC_MEMORY_ENABLED', 'false');
    const worker = vi.fn(); const open = vi.fn();
    vi.stubGlobal('Worker', worker); vi.stubGlobal('indexedDB', { open });
    const recall = vi.spyOn(semanticMemoryApplication, 'recall');
    expect(JSON.stringify(await userPlanningContextPromptSelectionHybridV2(params)))
      .toBe(JSON.stringify(userPlanningContextPromptSelectionV2(params)));
    expect(worker).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); expect(recall).not.toHaveBeenCalled();
  });
  it('without explicit owner consent remains exactly lexical', async () => {
    snapshot(); vi.stubEnv('VITE_SEMANTIC_MEMORY_ENABLED', 'true');
    vi.stubGlobal('localStorage', { getItem: () => null });
    const recall = vi.spyOn(semanticMemoryApplication, 'recall');
    expect(await userPlanningContextPromptSelectionHybridV2(params)).toEqual(userPlanningContextPromptSelectionV2(params));
    expect(recall).not.toHaveBeenCalled();
  });
  it('enabled facade adds only current revalidated semantic records', async () => {
    const records = snapshot(); vi.stubEnv('VITE_SEMANTIC_MEMORY_ENABLED', 'true');
    vi.stubGlobal('localStorage', { getItem: (key: string) => key.startsWith('laplance-semantic-memory-opt-in:') ? 'true' : null });
    vi.spyOn(semanticMemoryApplication, 'canonical').mockReturnValue({ ownerId: 'owner-1', revision: 5, records });
    vi.spyOn(semanticMemoryApplication, 'recall').mockResolvedValue({ status: 'ok', candidates: [{
      ownerId: 'owner-1', recordId: '7', sourceRevision: 5, score: 0.9,
      contentFingerprint: await semanticMemoryRecordFingerprint(records[7]),
    }] });
    const baseline = userPlanningContextPromptSelectionV2(params);
    const hybrid = await userPlanningContextPromptSelectionHybridV2(params);
    expect(hybrid.slice(0, baseline.length)).toEqual(baseline);
    expect(hybrid.slice(baseline.length)).toMatchObject([{ id: '7', relevanceTier: 'relevant' }]);
  });
  it('storage/model unavailable falls back byte-identically; owner invalidation drops pending context', async () => {
    const records = snapshot(); vi.stubEnv('VITE_SEMANTIC_MEMORY_ENABLED', 'true');
    vi.stubGlobal('localStorage', { getItem: (key: string) => key.startsWith('laplance-semantic-memory-opt-in:') ? 'true' : null });
    const canonical = vi.spyOn(semanticMemoryApplication, 'canonical').mockReturnValue({ ownerId: 'owner-1', revision: 5, records });
    const recall = vi.spyOn(semanticMemoryApplication, 'recall').mockResolvedValue({ status: 'unavailable', reason: 'storage_unavailable' });
    expect(JSON.stringify(await userPlanningContextPromptSelectionHybridV2(params)))
      .toBe(JSON.stringify(userPlanningContextPromptSelectionV2(params)));
    recall.mockImplementationOnce(async () => { canonical.mockReturnValue(null); return { status: 'no_match' }; });
    expect(await userPlanningContextPromptSelectionHybridV2(params)).toEqual([]);
  });
});
