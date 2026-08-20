import { readFileSync } from 'node:fs';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { WeeklyPlanningApplication } from '../features/weeklyPlanning/application/useWeeklyPlanningApplication';
import { createWeeklyPlanningTestDraftBlock } from '../features/weeklyPlanning/testUtils/weeklyPlanningApplicationTestHarness';
import { createInitialPlanningState, weeklyPlanningReducer } from '../features/weeklyPlanning/weeklyPlanningReducer';
import { WeeklyPlanningQuickEntryModal } from './WeeklyPlanningQuickEntryModal';

vi.mock('./QuickEntryModal', () => ({
  QuickEntryModal: (props: {
    weeklyPlanningMessages: Array<{ content: string }>;
  }) => (
    <div data-testid="quick-entry-modal">
      {props.weeklyPlanningMessages.map((message) => message.content).join('|')}
    </div>
  ),
}));

function application(kind: 'eligible' | 'recompute_required'): WeeklyPlanningApplication {
  const block = createWeeklyPlanningTestDraftBlock({ id: 'restored-block' });
  const state = weeklyPlanningReducer(createInitialPlanningState('2026-07-13'), {
    type: 'add_draft_blocks',
    blocks: [block],
  });
  const noop = () => undefined;
  return {
    state,
    pendingDraftBlocks: [block],
    approvalAvailability: kind === 'eligible'
      ? { kind: 'eligible', reason: 'current_session' }
      : {
          kind: 'recompute_required',
          reason: 'session_runtime_unavailable',
          message: '再読み込み前の仮予定です。最新条件で作り直してください。',
        },
    canEditDraftBlocks: true,
    submitTurn: async () => ({ accepted: false, draftCandidates: [] }),
    cancelTurn: () => false,
    clearConversation: () => false,
    appendMessage: noop,
    resetSession: noop,
    startConversation: noop,
    exportConversationSnapshot: () => null,
    loadConversationSnapshot: () => false,
    createDraftBlocks: noop,
    removePreviewCandidate: noop,
    removeDraftBlock: noop,
    clearDraftBlocks: noop,
    approveDraftBlocks: async () => undefined,
  };
}

const commonProps = {
  userId: 'user-1',
  selectedDate: '2026-07-14',
  plans: [],
  actuals: [],
  materials: [],
  subjects: [],
  onClose: () => undefined,
  onSaveTodo: async () => undefined,
  onSavePlan: async () => undefined,
  onSaveStandaloneActual: async () => undefined,
  onSaveLinkedActual: async () => undefined,
};

describe('WeeklyPlanningQuickEntryModal restored draft lifecycle', () => {
  it('shows recomputation guidance and marks approval unavailable', () => {
    const renderer = create(
      <WeeklyPlanningQuickEntryModal
        {...commonProps}
        application={application('recompute_required')}
      />,
    );
    const root = renderer.root.findByProps({
      'data-weekly-approval-availability': 'recompute_required',
    });

    expect(root.props.className).toBe('weekly-planning-approval-unavailable');
    expect(renderer.toJSON()).toEqual(expect.objectContaining({
      children: expect.arrayContaining([
        expect.objectContaining({
          children: expect.arrayContaining([
            expect.stringContaining('再読み込み前の仮予定です。最新条件で作り直してください。'),
          ]),
        }),
      ]),
    }));
  });

  it('does not mark the modal unavailable while the current runtime is eligible', () => {
    const renderer = create(
      <WeeklyPlanningQuickEntryModal
        {...commonProps}
        application={application('eligible')}
      />,
    );
    const root = renderer.root.findByProps({
      'data-weekly-approval-availability': 'eligible',
    });

    expect(root.props.className).toBeUndefined();
    expect(JSON.stringify(renderer.toJSON())).not.toContain('再読み込み前の仮予定です');
  });

  it('hides the approval action for the unavailable wrapper class', () => {
    const css = readFileSync(
      new URL('./WeeklyPlanningQuickEntryModal.css', import.meta.url),
      'utf8',
    );

    expect(css).toContain(
      '.weekly-planning-approval-unavailable .weekly-draft-action-bar .primary-button',
    );
    expect(css).toContain('display: none');
  });
});
