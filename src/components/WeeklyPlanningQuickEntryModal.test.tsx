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
    weeklyDraftBlocks: unknown[];
    weeklyPlanningPreviewCandidates?: unknown[];
    weeklyPlanningIntakeState: unknown;
    weeklyPlanningPendingTurn?: unknown;
    weeklyPlanningPendingApproval?: unknown;
  }) => (
    <div
      data-testid="quick-entry-modal"
      data-weekly-message-count={props.weeklyPlanningMessages.length}
      data-weekly-draft-count={props.weeklyDraftBlocks.length}
      data-weekly-preview-count={props.weeklyPlanningPreviewCandidates?.length ?? 0}
      data-has-weekly-intake={props.weeklyPlanningIntakeState ? 'true' : 'false'}
      data-has-weekly-pending-turn={props.weeklyPlanningPendingTurn ? 'true' : 'false'}
      data-has-weekly-pending-approval={props.weeklyPlanningPendingApproval ? 'true' : 'false'}
    />
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

describe('WeeklyPlanningQuickEntryModal manual quick-add boundary', () => {
  it('does not expose weekly AI state inside add-study even when a draft is pending', () => {
    const renderer = create(
      <WeeklyPlanningQuickEntryModal
        {...commonProps}
        application={application('recompute_required')}
      />,
    );
    const root = renderer.root.findByProps({
      'data-quick-entry-manual-only': 'true',
    });
    const modal = renderer.root.findByProps({ 'data-testid': 'quick-entry-modal' });

    expect(root.props['data-weekly-approval-availability']).toBe('recompute_required');
    expect(modal.props['data-weekly-message-count']).toBe(0);
    expect(modal.props['data-weekly-draft-count']).toBe(0);
    expect(modal.props['data-weekly-preview-count']).toBe(0);
    expect(modal.props['data-has-weekly-intake']).toBe('false');
    expect(modal.props['data-has-weekly-pending-turn']).toBe('false');
    expect(modal.props['data-has-weekly-pending-approval']).toBe('false');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('再読み込み前の仮予定です');
  });

  it('keeps the manual-only boundary for an eligible weekly planning runtime too', () => {
    const renderer = create(
      <WeeklyPlanningQuickEntryModal
        {...commonProps}
        application={application('eligible')}
      />,
    );

    expect(
      renderer.root.findByProps({ 'data-quick-entry-manual-only': 'true' }),
    ).toBeTruthy();
  });

  it('hides the manual/AI switch and AI panel only inside the manual-only quick-add wrapper', () => {
    const css = readFileSync(
      new URL('../styles/interaction-continuity.css', import.meta.url),
      'utf8',
    );

    expect(css).toContain("[data-quick-entry-manual-only='true'] .quick-entry-switch-card");
    expect(css).toContain("[data-quick-entry-manual-only='true'] .quick-entry-ai-panel");
    expect(css).toContain('display: none !important');
  });
});
