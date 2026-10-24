import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiPlanningView } from '../../components/AiPlanningView';
import {
  useWeeklyPlanningApplication,
  type WeeklyPlanningApplication,
} from './application/useWeeklyPlanningApplication';
import {
  getWeeklyPlanningStableV5RuntimeSession,
  commitWeeklyPlanningStableV5RuntimeGraph,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from './application/weeklyPlanningStableV5RuntimeSession';
import { createInitialPlanningIntakeState } from './intake/weeklyPlanningIntakeReducer';
import { createReadyPlannerDataAvailability } from './testUtils/plannerDataAvailabilityTest';
import { createDeferred, createMemoryStorageHarness } from './testUtils/weeklyPlanningApplicationTestHarness';
import type { WeeklyPlanningTurnExecutionInput } from './weeklyPlanningTurnExecutor';

const execute = vi.hoisted(() => vi.fn());
vi.mock('./weeklyPlanningTurnExecutor', async () => ({
  ...await vi.importActual<typeof import('./weeklyPlanningTurnExecutor')>('./weeklyPlanningTurnExecutor'),
  executeWeeklyPlanningTurn: execute,
}));
// Repository IO is outside this owner/view-lifetime contract.
vi.mock('../../repositories', () => ({
  plannerRepository: { getTodos: async () => [], getStudyMaterials: async () => [] },
}));

const USER_ID = 'user-1';
const SELECTED_DATE = '2026-07-16';
const USER_TEXT = 'レポートを1時間進めたい';
let application: WeeklyPlanningApplication;
let setViewMounted: (mounted: boolean) => void;
let renderer: ReactTestRenderer | undefined;
const save = vi.fn();
class PreviewTrigger { closest() { return this; } }

function SessionOwnerHarness() {
  const [viewMounted, setMounted] = useState(true);
  setViewMounted = setMounted;
  application = useWeeklyPlanningApplication({
    userId: USER_ID, selectedDate: SELECTED_DATE, plans: [], scheduleTemplates: [],
    plannerDataAvailability: createReadyPlannerDataAvailability(USER_ID),
    isPlannerDataSnapshotCurrent: () => true,
    saveWeeklyApprovedPlan: save,
  });
  return viewMounted ? <AiPlanningView application={application} userId={USER_ID} selectedDate={SELECTED_DATE} plans={[]} /> : null;
}

beforeEach(() => {
  const { storage } = createMemoryStorageHarness();
  vi.stubGlobal('window', {
    localStorage: storage, sessionStorage: storage,
    matchMedia: () => ({ matches: false }), confirm: vi.fn(() => true),
  });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network forbidden by fixture'); }));
  vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'false');
  vi.stubGlobal('Element', PreviewTrigger);
  execute.mockReset();
  save.mockReset();
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
});

afterEach(() => {
  act(() => renderer?.unmount()); renderer = undefined;
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

describe('weekly planning preview session lifecycle', () => {
  it('commits an App-owned Promise result while the modal child is unmounted and restores it on remount', async () => {
    const turn = createDeferred<void>();
    execute.mockImplementation(async (input: WeeklyPlanningTurnExecutionInput) => {
      await turn.promise;
      const session = getWeeklyPlanningStableV5RuntimeSession(input.conversationId)!;
      const graph = { ...session.graph, revision: session.graph.revision + 1,
        appliedTurnKeys: [...session.graph.appliedTurnKeys, `${input.conversationId}:${input.traceRequestId}`] };
      commitWeeklyPlanningStableV5RuntimeGraph({ ownerId: USER_ID,
        conversationId: input.conversationId, graph });
      return {
        state: { ...createInitialPlanningIntakeState(), sourceTurns: [input.userText] },
        message: '仮予定を作成しました。',
        draftCandidates: [{
          stableKey: 'preview-report-1', date: '2026-07-16', startTime: '19:00', endTime: '20:00',
          durationMinutes: 60, title: 'レポート作成', field: '情報学', year: 0, estimatedMinutes: 60,
          source: 'weekly_exam_prep', approvalStatus: 'unapproved', workItemKey: 'task:report',
          stableV5Metadata: { runtime: 'stable_v5', conversationId: input.conversationId,
            graphRevision: graph.revision, taskId: 'task:report', sourceFactRefs: ['fact:report-duration'], planType: 'study' },
        }],
      };
    });
    await act(async () => { renderer = create(<SessionOwnerHarness />); });
    act(() => renderer!.root.findByType('textarea').props.onChange({ target: { value: USER_TEXT } }));
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '送信' }).props.onClick(); });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    expect(application.state.pendingTurn).toBeDefined();
    const revision = application.state.revision;

    act(() => setViewMounted(false));
    expect(renderer!.toJSON()).toBeNull();
    await act(async () => { turn.resolve(); });
    await vi.waitFor(() => expect(application.state.pendingTurn).toBeUndefined());
    expect(application.state.revision).toBe(revision + 1);
    expect(application.state.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: USER_TEXT }, { role: 'assistant', content: '仮予定を作成しました。' },
    ]);
    expect(application.state.previewCandidates).toHaveLength(1);
    expect(application.state.previewCandidates![0]).toMatchObject({
      stableKey: 'preview-report-1', title: 'レポート作成', date: '2026-07-16',
      startTime: '19:00', endTime: '20:00', approvalStatus: 'unapproved',
    });
    const committedPreview = application.state.previewCandidates;

    await act(async () => { setViewMounted(true); });
    const rendered = JSON.stringify(renderer!.toJSON());
    expect(rendered).toContain(USER_TEXT);
    expect(rendered).toContain('仮予定を作成しました。');
    expect(rendered).toContain('計画プレビューを確認');
    act(() => renderer!.root.findByProps({ className: 'ai-planning-view-shell-v2 ' }).props.onClickCapture({
      target: new PreviewTrigger(), preventDefault() {}, stopPropagation() {},
    }));
    const restoredPreview = JSON.stringify(renderer!.toJSON());
    expect(restoredPreview).toContain('レポート作成');
    expect(restoredPreview).toContain('この内容で仮予定にする');
    expect(application.state.previewCandidates).toBe(committedPreview);
    expect(application.state.draftBlocks).toEqual([]);
    expect(application.state.pendingApproval).toBeUndefined();
    expect(execute).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
  });
});
