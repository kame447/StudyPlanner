import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserPlanningContextProvider, useUserPlanningContextV1 } from './UserPlanningContextContext';
import {
  finalizeStagedUserPlanningContextV1,
  hasStagedUserPlanningContextV1,
  loadUserPlanningContextSnapshotV1,
  readUserPlanningContextSnapshotV1,
  resetUserPlanningContextRuntimeForTestV1,
  stageUserPlanningContextFactsV1,
} from './userPlanningContextSpace';
import { selectUserPlanningContextPromptRecordsV2, userPlanningContextPromptSelectionV2 } from './userPlanningContextPromptSelectionV2';
import { createEmptyUserPlanningContextSnapshotV1, type UserPlanningContextRecordV1 } from './userPlanningContextTypes';

const repository = vi.hoisted(() => ({ initialize: vi.fn(), subscribe: vi.fn() }));
vi.mock('./userPlanningContextRepository', () => ({
  getUserPlanningContextRepositoryV1: () => repository,
}));

const ownerId = 'memory-owner';
const key = `studyplanner.userPlanningContext.${ownerId}`;
const params = { ownerId, currentDate: '2026-11-08' };
let raw: Map<string, string>;
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };
let renderer: ReactTestRenderer | undefined;

function Consumer() {
  const memory = useUserPlanningContextV1();
  return <><span>{memory.error ?? 'ready'}</span><output>{memory.records.map(item => item.id).join(',')}</output></>;
}

function record(overrides: Partial<UserPlanningContextRecordV1> = {}): UserPlanningContextRecordV1 {
  return {
    id: 'prior-concern', ownerId, kind: 'concern', label: '数学', value: '苦手',
    dateExpression: null, observedDate: '2026-11-01', resolvedDate: null,
    sourceText: '数学が苦手です', sourceConversationId: 'previous-session', sourceTurnId: 'prior-turn',
    recordedAt: '2026-11-01T09:00:00.000Z', status: 'active', origin: 'user_stated', ...overrides,
  };
}

beforeEach(() => {
  resetUserPlanningContextRuntimeForTestV1();
  raw = new Map();
  storage = {
    getItem: vi.fn((name: string) => raw.get(name) ?? null),
    setItem: vi.fn((name: string, value: string) => { raw.set(name, value); }),
    removeItem: vi.fn((name: string) => { raw.delete(name); }),
  };
  vi.stubGlobal('window', { localStorage: storage });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  repository.initialize.mockReset().mockImplementation(async (_owner, snapshot) => ({ snapshot, revision: 1, shared: true }));
  repository.subscribe.mockReset().mockReturnValue(() => undefined);
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('existing-format memory reads', () => {
  it.each([
    ['malformed JSON', '{unfinished'],
    ['empty stored string', ''],
    ['wrong owner', JSON.stringify(createEmptyUserPlanningContextSnapshotV1('other-owner'))],
    ['oversized snapshot', ' '.repeat(256 * 1024 + 1)],
  ])('preserves the original bytes on %s instead of deleting them', (_name, value) => {
    raw.set(key, value);
    expect(loadUserPlanningContextSnapshotV1(params).records).toEqual([]);
    expect(readUserPlanningContextSnapshotV1(params)).toEqual({ kind: 'unavailable', reason: 'invalid_data' });
    expect(raw.get(key) === value).toBe(true);
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('distinguishes a successful absent source from a failed storage read', () => {
    expect(readUserPlanningContextSnapshotV1(params)).toEqual({ kind: 'available', snapshot: createEmptyUserPlanningContextSnapshotV1(ownerId) });
    storage.getItem.mockImplementation(() => { throw new Error('storage unavailable'); });
    expect(readUserPlanningContextSnapshotV1(params)).toEqual({ kind: 'unavailable', reason: 'storage_unavailable' });
    expect(loadUserPlanningContextSnapshotV1(params).records).toEqual([]);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('handles denial of access to the storage object itself without treating it as absence', () => {
    vi.stubGlobal('window', { get localStorage() { throw new Error('SecurityError'); } });
    expect(readUserPlanningContextSnapshotV1(params)).toEqual({ kind: 'unavailable', reason: 'storage_unavailable' });
  });

  it('preserves normal cross-session records, lifecycle projection and bounded legacy selection', () => {
    const records = [
      record({ id: 'goal', kind: 'study_goal', label: '志望校' }),
      record(),
      ...Array.from({ length: 12 }, (_, i) => record({ id: `other-${i}`, label: `分野${i}` })),
      record({ id: 'revoked', status: 'revoked' }),
      record({ id: 'past-event', kind: 'goal_event', dateExpression: '2026-11-02', resolvedDate: '2026-11-02' }),
    ];
    const snapshot = { ...createEmptyUserPlanningContextSnapshotV1(ownerId), records, updatedAt: '2026-11-01T09:00:00.000Z' };
    const source = JSON.stringify(snapshot);
    raw.set(key, source);
    const projected = { ...snapshot, records: records.map(item => item.id === 'past-event' ? { ...item, status: 'needs_review' as const } : item) };
    expect(readUserPlanningContextSnapshotV1(params)).toEqual({ kind: 'available', snapshot: projected });
    const selected = userPlanningContextPromptSelectionV2({ ...params, relevantScopeKeys: ['数学'] });
    expect(selected).toEqual(selectUserPlanningContextPromptRecordsV2({ records: projected.records, relevantScopeKeys: ['数学'] }));
    expect(selected.map(item => item.id)).toEqual(['goal', 'prior-concern', 'other-0', 'other-1', 'other-2', 'other-3']);
    expect(raw.get(key)).toBe(source);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it.each(['invalid', 'unavailable'])('refuses to merge staged memory into an %s source and permits recovery', (failure) => {
    const turn = { ownerId, conversationId: 'new-session', requestId: 'new-turn' };
    stageUserPlanningContextFactsV1({ ...turn, observedDate: params.currentDate, now: '2026-11-08T09:00:00.000Z',
      facts: [{ localId: 'new-concern', kind: 'concern', label: '英語', value: '復習したい', dateExpression: null, sourceText: '英語を復習したい' }] });
    raw.set(key, '{unfinished');
    if (failure === 'unavailable') storage.getItem.mockImplementation(() => { throw new Error('storage unavailable'); });
    expect(() => finalizeStagedUserPlanningContextV1(turn)).toThrow('refusing to overwrite');
    expect(hasStagedUserPlanningContextV1(turn)).toBe(true);
    expect(raw.get(key)).toBe('{unfinished');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    raw.set(key, JSON.stringify({ ...createEmptyUserPlanningContextSnapshotV1(ownerId), records: [record()] }));
    storage.getItem.mockImplementation((name: string) => raw.get(name) ?? null);
    expect(finalizeStagedUserPlanningContextV1(turn)?.committedRecords).toHaveLength(1);
    expect(loadUserPlanningContextSnapshotV1(params).records.map(item => item.label).sort()).toEqual(['数学', '英語']);
    expect(finalizeStagedUserPlanningContextV1(turn)).toBeNull();
    expect(storage.setItem).toHaveBeenCalledOnce();
  });

  it.each(['invalid', 'unavailable'])('does not migrate an %s local read as empty memory', async (failure) => {
    if (failure === 'invalid') raw.set(key, '{unfinished');
    else storage.getItem.mockImplementation(() => { throw new Error('storage unavailable'); });
    await act(async () => { renderer = create(<UserPlanningContextProvider ownerId={ownerId}><Consumer /></UserPlanningContextProvider>); });
    expect(repository.initialize).not.toHaveBeenCalled();
    expect(repository.subscribe).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(renderer!.root.findByType('span').children.join('')).toBe('AIが覚えている情報を同期できませんでした。');
  });

  it('still initializes a successfully read empty account', async () => {
    await act(async () => { renderer = create(<UserPlanningContextProvider ownerId={ownerId}><Consumer /></UserPlanningContextProvider>); });
    expect(repository.initialize).toHaveBeenCalledWith(ownerId, createEmptyUserPlanningContextSnapshotV1(ownerId));
    expect(repository.subscribe).toHaveBeenCalledOnce();
    expect(renderer!.root.findByType('span').children.join('')).toBe('ready');
  });

  it('initializes existing memory intact and clears that display if the next owner cannot be read', async () => {
    const snapshot = { ...createEmptyUserPlanningContextSnapshotV1(ownerId), records: [record()] };
    raw.set(key, JSON.stringify(snapshot));
    await act(async () => { renderer = create(<UserPlanningContextProvider ownerId={ownerId}><Consumer /></UserPlanningContextProvider>); });
    expect(repository.initialize).toHaveBeenCalledWith(ownerId, snapshot);
    expect(renderer!.root.findByType('output').children.join('')).toBe('prior-concern');
    raw.set('studyplanner.userPlanningContext.next-owner', '{unfinished');
    await act(async () => { renderer!.update(<UserPlanningContextProvider ownerId="next-owner"><Consumer /></UserPlanningContextProvider>); });
    expect(repository.initialize).toHaveBeenCalledOnce();
    expect(renderer!.root.findByType('output').children).toEqual([]);
    expect(renderer!.root.findByType('span').children.join('')).toBe('AIが覚えている情報を同期できませんでした。');
    expect(raw.get('studyplanner.userPlanningContext.next-owner')).toBe('{unfinished');
  });
});
