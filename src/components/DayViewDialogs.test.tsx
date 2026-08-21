import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { ActualEditorCard } from './ActualEditorCard';
import { DayDetailModal } from './DayDetailModal';
import { DayTimetableImportDialog } from './DayTimetableImportDialog';
import { StandaloneActualEditorCard } from './StandaloneActualEditorCard';
import type { TimetableImportCandidate } from '../lib/timetableImport';
import type { Actual, MonthEvent, Plan } from '../types/domain';

const plan: Plan = {
  id: 'plan-1',
  seriesId: 'plan-1',
  userId: 'user-1',
  title: '数学',
  subject: '数学',
  date: '2026-08-14',
  startTime: '19:00',
  endTime: '20:00',
  repeat: 'none',
  repeatUntil: null,
  excludedDates: [],
  recurrenceRules: [],
  type: 'study',
  memo: '',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const standaloneActual: Actual = {
  id: 'actual-1',
  userId: 'user-1',
  planId: null,
  occurrenceDate: '2026-08-14',
  actualStartTime: '18:00',
  actualEndTime: '18:30',
  title: '英単語',
  subject: '英語',
  note: '',
  updatedAt: '2026-08-14T09:30:00.000Z',
};

const monthEvent: MonthEvent = {
  id: 'event-1',
  userId: 'user-1',
  date: '2026-08-14',
  title: '模試',
  startTime: '09:00',
  endTime: '12:00',
  repeat: 'none',
  repeatUntil: null,
  excludedDates: [],
  url: '',
  memo: '',
  checklist: [],
  locationTags: [],
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

function createCandidate(
  id: string,
  title: string,
  startTime: string,
  endTime: string,
): TimetableImportCandidate {
  return {
    id,
    sourceId: id,
    templates: [],
    title,
    subject: title,
    type: 'study',
    weekday: 'fri',
    termId: 'term-1',
    startTime,
    endTime,
    periodLabel: '',
    classroom: '',
    memo: '',
    isGrouped: false,
  };
}

const noopAsync = vi.fn().mockResolvedValue(undefined);

describe('DayView extracted dialogs', () => {
  it('imports only selected timetable candidates that are not already reflected', async () => {
    const candidates = [
      createCandidate('source-1', '数学', '09:00', '10:00'),
      createCandidate('source-2', '英語', '10:00', '11:00'),
    ];
    const onSavePlan = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        <DayTimetableImportDialog
          open
          dateLabel="2026年8月14日"
          selectedDate="2026-08-14"
          userId="user-1"
          candidates={candidates}
          importedSourceIds={new Set(['source-2'])}
          onSavePlan={onSavePlan}
          onClose={onClose}
        />,
      );
    });

    const checkboxes = renderer.root.findAllByType('input');
    expect(checkboxes.map((input) => [input.props.checked, input.props.disabled])).toEqual([
      [true, false],
      [false, true],
    ]);

    const importButton = renderer.root.findAllByType('button').find(
      (button) => button.props.className === 'primary-button',
    );

    await act(async () => {
      importButton?.props.onClick();
      await Promise.resolve();
    });

    expect(onSavePlan).toHaveBeenCalledTimes(1);
    expect(onSavePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        date: '2026-08-14',
        title: '数学',
        sourceType: 'timetable',
        sourceId: 'source-1',
      }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens the planned actual editor from the record action sheet', () => {
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        <DayDetailModal
          detailPlan={plan}
          monthEvent={monthEvent}
          standaloneActual={null}
          plans={[plan]}
          actuals={[]}
          onEditPlan={vi.fn()}
          onDeletePlan={noopAsync}
          onSaveActual={noopAsync}
          onSaveStandaloneActual={noopAsync}
          onLinkStandaloneActualToPlan={noopAsync}
          onDeleteActual={noopAsync}
          onClose={vi.fn()}
        />,
      );
    });

    const recordAction = renderer.root.findAllByType('button').find((button) =>
      button.findAllByType('strong').some((label) => label.children.join('') === '記録を保存'),
    );
    expect(recordAction).toBeDefined();

    act(() => {
      recordAction?.props.onClick();
    });

    const editor = renderer.root.findByType(ActualEditorCard);
    expect(editor.props.plan).toBe(plan);
    expect(editor.props.forceOpen).toBe(true);
    expect(editor.props.hideToggleButton).toBe(true);
    expect(editor.props.hidePlanActions).toBe(true);
  });

  it('maps standalone records to the standalone editor contract', () => {
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        <DayDetailModal
          detailPlan={null}
          monthEvent={null}
          standaloneActual={standaloneActual}
          plans={[plan]}
          actuals={[standaloneActual]}
          onEditPlan={vi.fn()}
          onDeletePlan={noopAsync}
          onSaveActual={noopAsync}
          onSaveStandaloneActual={noopAsync}
          onLinkStandaloneActualToPlan={noopAsync}
          onDeleteActual={noopAsync}
          onClose={vi.fn()}
        />,
      );
    });

    expect(renderer.root.findByType(StandaloneActualEditorCard).props.actual).toBe(
      standaloneActual,
    );
  });
});
