import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WeeklyPlanningApplication } from '../features/weeklyPlanning/application/useWeeklyPlanningApplication';
import type { WeeklyDraftCandidate } from '../features/weeklyPlanning/scheduling/weeklyDraftCandidateGenerator';
import type { PlanningState, WeeklyPlanDraftBlock } from '../features/weeklyPlanning/types';
import { createInitialPlanningIntakeState } from '../features/weeklyPlanning/intake/weeklyPlanningIntakeReducer';
import { createInitialPlanningState, weeklyPlanningReducer } from '../features/weeklyPlanning/weeklyPlanningReducer';
import { AiPlanningPreviewDialog } from './AiPlanningPreviewDialog';
import { AiPlanningView } from './AiPlanningView';

vi.mock('./AiPlanningViewLegacy', () => ({ AiPlanningView: () => null }));
vi.mock('./AiPlanningPreviewDialog', () => ({ AiPlanningPreviewDialog: () => null }));

const candidate = (stableKey: string): WeeklyDraftCandidate => ({
  stableKey, date: '2026-10-19', startTime: '19:00', endTime: '20:00',
  durationMinutes: 60, title: '数学', field: 'math', year: 2026,
  estimatedMinutes: 60, source: 'weekly_exam_prep', approvalStatus: 'unapproved', workItemKey: stableKey,
});
class PreviewTrigger { closest() { return this; } }
let renderer: ReactTestRenderer | undefined;
let state: PlanningState;
let publish: (next: PlanningState) => void;
const checkpoint = vi.fn();
const createDraftBlocks = vi.fn((blocks: WeeklyPlanDraftBlock[]) => {
  // Match the application's synchronous authoritative dispatch; the view
  // receives the resulting state only when React commits the queued render.
  const before = state;
  state = weeklyPlanningReducer(state, { type: 'add_draft_blocks', blocks });
  publish(state);
  return state !== before;
});

function Harness() {
  const [visibleState, setVisibleState] = useState(state);
  publish = setVisibleState;
  const application = {
    state: visibleState, pendingDraftBlocks: visibleState.draftBlocks,
    approvalAvailability: { kind: 'eligible' },
    chat: { checkpoint, requiresInitialization: false },
    createDraftBlocks,
  } as unknown as WeeklyPlanningApplication;
  return <AiPlanningView application={application} userId="preview-user" selectedDate="2026-10-19" plans={[]} />;
}

function dialog() { return renderer!.root.findByType(AiPlanningPreviewDialog); }
function promote() {
  const { onPromote, blocks } = dialog().props;
  return () => onPromote(blocks);
}

beforeEach(() => {
  vi.stubGlobal('Element', PreviewTrigger);
  createDraftBlocks.mockClear();
  checkpoint.mockClear();
  state = { ...createInitialPlanningState('2026-10-19'), previewCandidates: [candidate('first')], mode: 'draft_created' };
  act(() => { renderer = create(<Harness />); });
  act(() => {
    renderer!.root.findByProps({ className: 'ai-planning-view-shell-v2 ' }).props.onClickCapture({
      target: new PreviewTrigger(), preventDefault() {}, stopPropagation() {},
    });
  });
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it('consumes a preview once for any number of activations before React commits', () => {
  const activate = promote();
  const revision = state.revision;
  act(() => { for (let i = 0; i < 5; i += 1) activate(); });
  expect(createDraftBlocks).toHaveBeenCalledOnce();
  expect(checkpoint).toHaveBeenCalledOnce();
  expect(state.draftBlocks.map(block => block.id)).toEqual(['first']);
  expect(state.revision).toBe(revision + 1);
  expect(state.mode).toBe('awaiting_approval');
  expect(dialog().props.hasLocalPreview).toBe(false);
  // Even a retained old callback cannot append that preview again.
  act(() => activate());
  expect(createDraftBlocks).toHaveBeenCalledOnce();
});

it('allows a fresh preview while keeping an already consumed callback inert', () => {
  const oldActivate = promote();
  act(() => oldActivate());
  state = { ...state, revision: state.revision + 1, draftBlocks: [], previewCandidates: [candidate('second')] };
  act(() => publish(state));
  const activate = promote();
  const revision = state.revision;
  act(() => { activate(); oldActivate(); activate(); });
  expect(createDraftBlocks).toHaveBeenCalledTimes(2);
  expect(state.draftBlocks.map(block => block.id)).toEqual(['second']);
  expect(state.revision).toBe(revision + 1);
});

it('does not consume a preview when no displayed blocks can be promoted', () => {
  act(() => dialog().props.onPromote([]));
  expect(createDraftBlocks).not.toHaveBeenCalled();
  const activate = promote();
  act(() => activate());
  expect(createDraftBlocks).toHaveBeenCalledOnce();
});

it('keeps a preview retryable when the planning state rejects the promotion', () => {
  const activate = promote();
  const accepted = state;
  // The reducer refuses draft blocks while a repair question is still open.
  state = { ...state, intakeState: { ...createInitialPlanningIntakeState(), status: 'revision_pending', questions: ['いつにしますか'] } } as PlanningState;
  act(() => activate());
  expect(createDraftBlocks).toHaveBeenCalledOnce();
  expect(state.draftBlocks).toEqual([]);
  state = { ...accepted };
  act(() => activate());
  expect(createDraftBlocks).toHaveBeenCalledTimes(2);
  expect(state.draftBlocks.map(block => block.id)).toEqual(['first']);
});
