import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createInitialPlanningIntakeState } from '../features/weeklyPlanning/intake/weeklyPlanningIntakeReducer';
import type {
  WeeklyPlanDraftBlock,
  WeeklyPlanningMessage,
  WeeklyPlanningPendingApproval,
  WeeklyPlanningPendingTurn,
} from '../features/weeklyPlanning/types';
import { QuickEntryModal } from './QuickEntryModal';

const NOW = '2026-07-16T00:00:00.000Z';

function message(content: string): WeeklyPlanningMessage {
  return {
    id: 'message-1',
    role: 'user',
    content,
    createdAt: NOW,
  };
}

function pendingTurn(): WeeklyPlanningPendingTurn {
  return {
    requestId: 'turn-1',
    weekStartDate: '2026-07-13',
    baseRevision: 0,
    startedAt: NOW,
  };
}

function draftBlock(): WeeklyPlanDraftBlock {
  return {
    id: 'draft-1',
    userId: 'user-1',
    date: '2026-07-16',
    startTime: '19:00',
    endTime: '20:00',
    title: '英語ワーク',
    subject: '英語',
    type: 'study',
    label: '英語',
    source: 'ai',
    status: 'draft',
    userEdited: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function renderModal(overrides: Partial<Parameters<typeof QuickEntryModal>[0]> = {}) {
  return renderToStaticMarkup(
    <QuickEntryModal
      userId="user-1"
      selectedDate="2026-07-16"
      plans={[]}
      actuals={[]}
      materials={[]}
      subjects={[]}
      weeklyDraftBlocks={[]}
      weeklyPlanningMessages={[]}
      weeklyPlanningIntakeState={null}
      weeklyPlanningWeekStartDate="2026-07-13"
      weeklyPlanningRevision={0}
      onSubmitWeeklyPlanningTurn={vi.fn(async () => ({
        accepted: true,
        draftCandidates: [],
      }))}
      onAppendWeeklyPlanningMessage={vi.fn()}
      onResetWeeklyPlanningSession={vi.fn()}
      onCreateWeeklyDraftBlocks={vi.fn()}
      onRemoveWeeklyDraftBlock={vi.fn()}
      onClearWeeklyDraftBlocks={vi.fn()}
      onApproveWeeklyDraftBlocks={vi.fn(async () => undefined)}
      onClose={vi.fn()}
      onSaveTodo={vi.fn(async () => undefined)}
      onSavePlan={vi.fn(async () => undefined)}
      onSaveStandaloneActual={vi.fn(async () => undefined)}
      onSaveLinkedActual={vi.fn(async () => undefined)}
      {...overrides}
    />,
  );
}

describe('QuickEntryModal weekly planning session resume', () => {
  it('reopens directly in the weekly AI view and keeps the composer hidden while a turn is pending', () => {
    const html = renderModal({
      weeklyPlanningMessages: [message('今週の予定を作りたい')],
      weeklyPlanningPendingTurn: pendingTurn(),
    });

    expect(html).toContain('quick-entry-ai-panel');
    expect(html).toContain('今週の予定を作りたい');
    expect(html).toContain('weekly-planning-typing-indicator');
    expect(html).not.toContain('週間計画にしたいこと');
    expect(html).not.toContain('例: 英語課題 / 面接準備');
  });

  it('reopens an intake-only session and exposes the weekly reset action', () => {
    const html = renderModal({
      weeklyPlanningIntakeState: createInitialPlanningIntakeState(),
    });

    expect(html).toContain('quick-entry-ai-panel');
    expect(html).toContain('週間計画にしたいこと');
    expect(html).toContain('この週の相談をリセット');
  });

  it('renders approval as busy and disables draft mutations', () => {
    const block = draftBlock();
    const approval: WeeklyPlanningPendingApproval = {
      requestId: 'approval-1',
      weekStartDate: '2026-07-13',
      baseRevision: 1,
      blockIds: [block.id],
      startedAt: NOW,
    };
    const html = renderModal({
      weeklyDraftBlocks: [block],
      weeklyPlanningPendingApproval: approval,
    });

    expect(html).toContain('保存中…');
    expect(html).toContain('英語ワークを削除');
    expect(html).toMatch(/英語ワークを削除[^>]*disabled/);
    expect(html).toMatch(/一括破棄<\/button>/);
  });
});
