import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WeeklyPlanningApplication } from '../features/weeklyPlanning/application/useWeeklyPlanningApplication';
import type { WeeklyDraftCandidate } from '../features/weeklyPlanning/scheduling/weeklyDraftCandidateGenerator';
import type { PlanningState, WeeklyPlanDraftBlock } from '../features/weeklyPlanning/types';
import { createInitialPlanningState, weeklyPlanningReducer } from '../features/weeklyPlanning/weeklyPlanningReducer';
import { UserFacingError } from '../lib/userFacingError';
import { AiPlanningPreviewDialog } from './AiPlanningPreviewDialog';
import { AiPlanningView } from './AiPlanningView';

vi.mock('./AiPlanningViewLegacy', () => ({ AiPlanningView: () => null }));
vi.mock('./AiPlanningPreviewDialog', () => ({ AiPlanningPreviewDialog: () => null }));

// The preview's save button must close the dialog only when the application did not refuse the approval.
const candidate: WeeklyDraftCandidate = {
  stableKey: 'first', date: '2026-10-19', startTime: '19:00', endTime: '20:00',
  durationMinutes: 60, title: '数学', field: 'math', year: 2026,
  estimatedMinutes: 60, source: 'weekly_exam_prep', approvalStatus: 'unapproved', workItemKey: 'first',
};
class PreviewTrigger { closest() { return this; } }
let renderer: ReactTestRenderer | undefined;
let state: PlanningState;
const approveDraftBlocks = vi.fn<() => Promise<void>>();

function Harness() {
  const [visibleState, setVisibleState] = useState(state);
  const application = {
    state: visibleState, pendingDraftBlocks: visibleState.draftBlocks,
    approvalAvailability: { kind: 'eligible' },
    chat: { checkpoint: vi.fn(), requiresInitialization: false },
    createDraftBlocks: (blocks: WeeklyPlanDraftBlock[]) => {
      state = weeklyPlanningReducer(state, { type: 'add_draft_blocks', blocks });
      setVisibleState(state); return true;
    },
    clearDraftBlocks: vi.fn(), approveDraftBlocks,
  } as unknown as WeeklyPlanningApplication;
  return <AiPlanningView application={application} userId="preview-user" selectedDate="2026-10-19" plans={[]} />;
}
const dialogs = () => renderer!.root.findAllByType(AiPlanningPreviewDialog);
const dialog = () => renderer!.root.findByType(AiPlanningPreviewDialog);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Element', PreviewTrigger);
  approveDraftBlocks.mockReset();
  state = { ...createInitialPlanningState('2026-10-19'), previewCandidates: [candidate], mode: 'draft_created' };
  act(() => { renderer = create(<Harness />); });
  act(() => {
    renderer!.root.findByProps({ className: 'ai-planning-view-shell-v2 ' }).props.onClickCapture({
      target: new PreviewTrigger(), preventDefault() {}, stopPropagation() {},
    });
  });
  act(() => dialog().props.onPromote(dialog().props.blocks)); // a pending draft block now exists
});
afterEach(() => {
  act(() => renderer?.unmount()); renderer = undefined;
  vi.unstubAllGlobals(); vi.useRealTimers();
});

async function save() {
  await act(async () => { dialog().props.onSave(dialog().props.blocks); await vi.advanceTimersByTimeAsync(1000); });
}

it('keeps the preview open and shows the reason when the approval is refused', async () => {
  approveDraftBlocks.mockRejectedValue(new UserFacingError('同期を確認できなかったため、まだ保存していません。'));
  await save();
  expect(approveDraftBlocks).toHaveBeenCalledOnce();
  expect(dialogs()).toHaveLength(1);
  expect(dialog().props.error).toBe('同期を確認できなかったため、まだ保存していません。');
});

it('closes the preview after an approval that completed', async () => {
  approveDraftBlocks.mockResolvedValue(undefined);
  await save();
  expect(approveDraftBlocks).toHaveBeenCalledOnce();
  expect(dialogs()).toHaveLength(0);
});
