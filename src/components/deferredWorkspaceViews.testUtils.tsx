import { vi } from 'vitest';
import { DeferredDayView } from './DeferredDayView';
import { DeferredTimetableView } from './DeferredTimetableView';
import { DeferredReportView } from './DeferredReportView';

export type WorkspaceEntry = 'Day' | 'Timetable' | 'Report';
export const entries = ['Day', 'Timetable', 'Report'] as const;
export const selectedDate = '2026-10-17';
export const callbacks = { save: vi.fn(), remove: vi.fn(), navigate: vi.fn() };
export function view(entry: WorkspaceEntry, owner: string) {
  const common = { userId: owner, plans: [], actuals: [{ id: `record-${owner}`, userId: owner, planId: null, occurrenceDate: selectedDate, actualStartTime: '09:00', actualEndTime: '10:00', subject: '数学', isAlignedToPlan: false, note: '', updatedAt: '2026-10-17T10:00:00Z' }], selectedDate };
  if (entry === 'Day') return <DeferredDayView {...common} monthEvents={[]} studySubjects={[]} studyMaterials={[]}
    scheduleTemplates={[]} timetableTermId="default" onChangeDay={callbacks.navigate} onEditPlan={callbacks.navigate}
    onMovePlan={callbacks.save} onDeletePlan={callbacks.remove} onDeleteMonthEvent={callbacks.remove}
    onSavePlan={callbacks.save} onSaveActual={callbacks.save} onSaveStandaloneActual={callbacks.save}
    onLinkStandaloneActualToPlan={callbacks.save} onDeleteActual={callbacks.remove}
    onOpenBookshelf={callbacks.navigate} onOpenAddMaterial={callbacks.navigate} />;
  if (entry === 'Timetable') return <DeferredTimetableView {...common} activeTerm={null} timetablePeriods={[]} scheduleTemplates={[]}
    onActivateTerm={callbacks.save} onDeleteTerm={callbacks.remove} onClearTermData={callbacks.remove}
    onSaveTimetablePeriod={callbacks.save} onDeleteTimetablePeriod={callbacks.remove}
    onSaveScheduleTemplate={callbacks.save} onDeleteScheduleTemplate={callbacks.remove} />;
  return <DeferredReportView key={owner} {...common} onBack={callbacks.navigate} />;
}
