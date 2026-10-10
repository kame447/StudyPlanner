import { WEEKLY_PLANNING_PLAN_SOURCE_TYPE, parseWeeklyPlanningPlanSourceId } from '../features/weeklyPlanning/planning/weeklyPlanningPlanProvenance';
import { createPlanFromDraft } from '../domain/planner';
import type { PlanDraft } from '../types/domain';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useWeeklyPlanningApplication,
  type WeeklyPlanningApplication,
} from '../features/weeklyPlanning/application/useWeeklyPlanningApplication';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeSession';
import {
  loadAiPlanningChatIndex,
  loadAiPlanningChatSnapshot,
  saveAiPlanningChatIndex,
  saveAiPlanningChatSnapshot,
  updateAiPlanningChatRecord,
} from '../features/weeklyPlanning/chat/aiPlanningChatStore';
import {
  createMemoryStorageHarness,
  createWeeklyPlanningTestDraftBlock,
} from '../features/weeklyPlanning/testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from '../features/weeklyPlanning/testUtils/plannerDataAvailabilityTest';
import { WeeklyPlanningStableCollectionLimitError } from '../features/weeklyPlanning/weeklyPlanningStateCodec';
import { AiPlanningPreviewDialog } from './AiPlanningPreviewDialog';
import { AiPlanningView } from './AiPlanningView';

vi.mock('./AiPlanningViewLegacy', () => ({ AiPlanningView: () => null }));
vi.mock('./AiPlanningPreviewDialog', () => ({ AiPlanningPreviewDialog: () => null }));

const USER_ID = 'user-1';
const savePlan = vi.fn();
let application: WeeklyPlanningApplication;
let renderer: ReactTestRenderer | undefined;

function Harness() {
  application = useWeeklyPlanningApplication({
    userId: USER_ID,
    selectedDate: '2026-07-14',
    plans: [],
    scheduleTemplates: [],
    isPlannerDataSnapshotCurrent: () => true, plannerDataAvailability: createReadyPlannerDataAvailability(USER_ID),
    saveWeeklyApprovedPlan: savePlan,
  });
  return <AiPlanningView application={application} userId={USER_ID} selectedDate="2026-07-14" plans={[]} />;
}

class PreviewTrigger {
  closest() { return this; }
}

beforeEach(() => {
  savePlan.mockReset();
  const { storage } = createMemoryStorageHarness();
  vi.stubGlobal('window', {
    localStorage: storage,
    sessionStorage: storage,
    // Model navigation/backgrounding: callbacks never get a rendering frame.
    requestAnimationFrame: vi.fn(() => 1),
  });
  vi.stubGlobal('Element', PreviewTrigger);
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  vi.unstubAllGlobals();
});

describe('preview edit persistence', () => {
  it('keeps existing drafts and the error visible when edited replacement is rejected before approval', async () => {
    act(() => { renderer = create(<Harness />); });
    act(() => { application.createDraftBlocks([createWeeklyPlanningTestDraftBlock({ id: 'retained-draft' })]); });
    expect(application.approvalAvailability.kind).toBe('eligible');
    act(() => {
      renderer!.root.findByProps({ className: 'ai-planning-view-shell-v2 ' }).props.onClickCapture({
        target: new PreviewTrigger(), preventDefault: vi.fn(), stopPropagation: vi.fn(),
      });
    });
    const before = application.state.draftBlocks;
    const admissionError = new WeeklyPlanningStableCollectionLimitError({ collection: 'draftBlocks', actualCount: 501, limit: 500 });
    const clear = vi.spyOn(application, 'clearDraftBlocks');
    const createBlocks = vi.spyOn(application, 'createDraftBlocks').mockImplementation(() => { throw admissionError; });
    const approve = vi.spyOn(application, 'approveDraftBlocks');
    try {
      const edited = before.map(block => ({ ...block, startTime: '11:00', endTime: '12:00' }));
      await act(async () => {
        renderer!.root.findByType(AiPlanningPreviewDialog).props.onSave(edited);
        await Promise.resolve();
      });
      expect(createBlocks).toHaveBeenCalledTimes(1);
      expect(createBlocks).toHaveBeenCalledWith([expect.objectContaining({
        ...edited[0], userEdited: true, updatedAt: expect.any(String),
      })], { replace: true });
      expect(clear).not.toHaveBeenCalled();
      expect(approve).not.toHaveBeenCalled();
      expect(application.state.draftBlocks).toBe(before);
      expect(renderer!.root.findByType(AiPlanningPreviewDialog).props.error).toBe(admissionError.message);
    } finally {
      clear.mockRestore(); createBlocks.mockRestore(); approve.mockRestore();
    }
  });

  it('keeps the local preview and retained drafts visible when promotion replacement is rejected', () => {
    act(() => { renderer = create(<Harness />); });
    act(() => { application.createDraftBlocks([createWeeklyPlanningTestDraftBlock({ id: 'retained-draft' })]); });
    const snapshot = application.exportConversationSnapshot()!;
    act(() => {
      expect(application.loadConversationSnapshot({ ...snapshot, planningState: { ...snapshot.planningState,
        previewCandidates: [{ stableKey: 'promote-candidate', date: '2026-07-14', startTime: '09:00',
          endTime: '09:05', durationMinutes: 5, estimatedMinutes: 5, title: '数学', field: '数学',
          year: 0, source: 'weekly_exam_prep', approvalStatus: 'unapproved', workItemKey: 'count-fixture-work',
          stableV5Metadata: { runtime: 'stable_v5', conversationId: snapshot.conversationId,
            graphRevision: snapshot.graph.revision, taskId: 'count-fixture-task',
            sourceFactRefs: ['count-fixture-task'], planType: 'study' },
        }],
      } })).toBe(true);
    });
    act(() => {
      renderer!.root.findByProps({ className: 'ai-planning-view-shell-v2 ' }).props.onClickCapture({
        target: new PreviewTrigger(), preventDefault: vi.fn(), stopPropagation: vi.fn(),
      });
    });
    const before = application.state;
    const admissionError = new WeeklyPlanningStableCollectionLimitError({ collection: 'draftBlocks', actualCount: 501, limit: 500 });
    const clear = vi.spyOn(application, 'clearDraftBlocks');
    const createBlocks = vi.spyOn(application, 'createDraftBlocks').mockImplementation(() => { throw admissionError; });
    const approve = vi.spyOn(application, 'approveDraftBlocks');
    try {
      const dialog = renderer!.root.findByType(AiPlanningPreviewDialog);
      expect(dialog.props.hasLocalPreview).toBe(true);
      expect(dialog.props.blocks).toHaveLength(1);
      act(() => { dialog.props.onPromote(dialog.props.blocks); });
      expect(createBlocks).toHaveBeenCalledTimes(1);
      expect(createBlocks).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ id: 'promote-candidate' }),
      ]), { replace: true });
      expect(clear).not.toHaveBeenCalled();
      expect(approve).not.toHaveBeenCalled();
      expect(application.state).toBe(before);
      expect(application.state.draftBlocks).toBe(before.draftBlocks);
      expect(application.state.previewCandidates).toBe(before.previewCandidates);
      expect(renderer!.root.findByType(AiPlanningPreviewDialog).props.error).toBe(admissionError.message);
    } finally { clear.mockRestore(); createBlocks.mockRestore(); approve.mockRestore(); }
  });

  it('stops approval of an empty edited selection without saving the retained old drafts', async () => {
    act(() => { renderer = create(<Harness />); });
    act(() => { application.createDraftBlocks([createWeeklyPlanningTestDraftBlock({ id: 'old-not-selected' })]); });
    act(() => {
      renderer!.root.findByProps({ className: 'ai-planning-view-shell-v2 ' }).props.onClickCapture({
        target: new PreviewTrigger(), preventDefault: vi.fn(), stopPropagation: vi.fn(),
      });
    });
    const before = application.state;
    const approve = vi.spyOn(application, 'approveDraftBlocks');
    const replace = vi.spyOn(application, 'createDraftBlocks');
    try {
      await act(async () => {
        renderer!.root.findByType(AiPlanningPreviewDialog).props.onSave([]);
        await Promise.resolve();
      });
      expect(approve).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
      expect(savePlan).not.toHaveBeenCalled();
      expect(application.state).toBe(before);
      expect(renderer!.root.findByType(AiPlanningPreviewDialog).props.error).toBe('保存する仮予定がありません。');
    } finally { approve.mockRestore(); replace.mockRestore(); }
  });

  it('saves the unchanged full selection through the real approval path without replacement', async () => {
    savePlan.mockImplementation(async (draft: PlanDraft) => ({ ...createPlanFromDraft(draft), id: 'unchanged-plan' }));
    act(() => { renderer = create(<Harness />); });
    act(() => { application.createDraftBlocks([createWeeklyPlanningTestDraftBlock({ id: 'unchanged-draft' })]); });
    act(() => {
      renderer!.root.findByProps({ className: 'ai-planning-view-shell-v2 ' }).props.onClickCapture({
        target: new PreviewTrigger(), preventDefault: vi.fn(), stopPropagation: vi.fn(),
      });
    });
    const before = application.state;
    const originalApproval = application.approveDraftBlocks;
    let approval: Promise<void> | undefined;
    const approve = vi.spyOn(application, 'approveDraftBlocks').mockImplementation(() => {
      approval = originalApproval(); // Observe completion, without replacing the approval owner.
      return approval;
    });
    const replace = vi.spyOn(application, 'createDraftBlocks');
    try {
      await act(async () => {
        renderer!.root.findByType(AiPlanningPreviewDialog).props.onSave(before.draftBlocks);
        expect(approval).toBeDefined();
        await approval;
      });
      expect(approve).toHaveBeenCalledTimes(1);
      expect(replace).not.toHaveBeenCalled();
      expect(savePlan).toHaveBeenCalledTimes(1);
      expect(savePlan).toHaveBeenCalledWith(expect.objectContaining({
        date: before.draftBlocks[0].date, startTime: before.draftBlocks[0].startTime,
        endTime: before.draftBlocks[0].endTime, sourceType: WEEKLY_PLANNING_PLAN_SOURCE_TYPE,
      }));
      expect(parseWeeklyPlanningPlanSourceId(savePlan.mock.calls[0][0].sourceId)?.sourceDraftBlockId).toBe('unchanged-draft');
      expect(application.state.pendingApproval).toBeUndefined();
      expect(application.state.draftBlocks).toEqual([]);
      expect(application.state.lastAssistantMessage).toBe('1件の仮予定を通常予定として保存しました。');
    } finally { approve.mockRestore(); replace.mockRestore(); }
  });

  it('persists exact removals and the empty snapshot before another animation frame', () => {
    act(() => { renderer = create(<Harness />); });
    act(() => {
      application.createDraftBlocks([
        createWeeklyPlanningTestDraftBlock({ id: 'draft-a' }),
        createWeeklyPlanningTestDraftBlock({ id: 'draft-b' }),
      ]);
    });
    const blankIndex = loadAiPlanningChatIndex(USER_ID);
    const initialIndex = updateAiPlanningChatRecord(blankIndex, blankIndex.activeChatId, {
      weekStartDate: application.state.weekStartDate,
    });
    saveAiPlanningChatIndex(USER_ID, initialIndex);
    saveAiPlanningChatSnapshot(USER_ID, initialIndex.activeChatId, application.exportConversationSnapshot()!);
    act(() => {
      renderer!.root.findByProps({ className: 'ai-planning-view-shell-v2 ' }).props.onClickCapture({
        target: new PreviewTrigger(), preventDefault: vi.fn(), stopPropagation: vi.fn(),
      });
    });
    act(() => {
      renderer!.root.findByType(AiPlanningPreviewDialog).props.onRemove('draft-a');
    });
    const index = loadAiPlanningChatIndex(USER_ID);
    const active = index.chats.find(chat => chat.id === index.activeChatId)!;
    expect(loadAiPlanningChatSnapshot(USER_ID, active)?.planningState.draftBlocks.map(block => block.id))
      .toEqual(['draft-b']);

    act(() => {
      renderer!.root.findByType(AiPlanningPreviewDialog).props.onRemove('draft-b');
    });
    expect(application.state.draftBlocks).toEqual([]);
    expect(application.exportConversationSnapshot()).toBeNull();
    expect(application.exportConversationSnapshot({ includeEmpty: true })?.planningState.draftBlocks).toEqual([]);
    expect(loadAiPlanningChatSnapshot(USER_ID, active)?.planningState.draftBlocks).toEqual([]);
    expect(renderer!.root.findAllByType(AiPlanningPreviewDialog)).toHaveLength(0);
  });
});
