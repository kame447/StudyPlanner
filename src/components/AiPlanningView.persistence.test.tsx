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
import { AiPlanningPreviewDialog } from './AiPlanningPreviewDialog';
import { AiPlanningView } from './AiPlanningView';

vi.mock('./AiPlanningViewLegacy', () => ({ AiPlanningView: () => null }));
vi.mock('./AiPlanningPreviewDialog', () => ({ AiPlanningPreviewDialog: () => null }));

const USER_ID = 'user-1';
let application: WeeklyPlanningApplication;
let renderer: ReactTestRenderer | undefined;

function Harness() {
  application = useWeeklyPlanningApplication({
    userId: USER_ID,
    selectedDate: '2026-07-14',
    plans: [],
    scheduleTemplates: [],
    plannerDataAvailability: createReadyPlannerDataAvailability(USER_ID),
    saveWeeklyApprovedPlan: vi.fn(),
  });
  return <AiPlanningView application={application} userId={USER_ID} selectedDate="2026-07-14" plans={[]} />;
}

class PreviewTrigger {
  closest() { return this; }
}

beforeEach(() => {
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
