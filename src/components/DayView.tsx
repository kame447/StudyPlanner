import { useEffect, useMemo, useState } from 'react';
import { createScheduleOccurrenceProjection } from '../domain/scheduleOccurrence';
import { addDays, formatDateLabel, sortByDateTime } from '../lib/date';
import {
  buildPlanOccurrenceKey,
  expandPlansForDate,
  getActualOccurrenceKey,
  getRecurrenceWeekday,
} from '../lib/planRecurrence';
import type { WeekPlanMoveTarget } from '../lib/weekPlanDrag';
import { sortMonthEvents } from '../lib/monthEvents';
import { resolveTimetableTermForDate } from '../lib/timetableCalendar';
import { buildTimetableImportCandidates } from '../lib/timetableImport';
import { useSwipeNavigation } from '../hooks/useSwipeNavigation';
import { DailyMaterialShelf } from './DailyMaterialShelf';
import { DayDetailModal } from './DayDetailModal';
import { DayTimeline } from './DayTimeline';
import { DayTimetableImportDialog } from './DayTimetableImportDialog';
import { MaterialQuickCreateModal } from './MaterialQuickCreateModal';
import type { WeeklyPlanDraftBlock } from '../features/weeklyPlanning/types';
import type {
  Actual,
  ActualDraft,
  MonthEvent,
  Plan,
  PlanDraft,
  ScheduleTemplate,
  StudyMaterial,
  StudySubject,
  TimetableTerm,
} from '../types/domain';

interface DayViewProps {
  selectedDate: string;
  userId: string;
  plans: Plan[];
  actuals: Actual[];
  monthEvents: MonthEvent[];
  studySubjects: StudySubject[];
  studyMaterials: StudyMaterial[];
  scheduleTemplates: ScheduleTemplate[];
  timetableTermId: string;
  timetableTerm?: TimetableTerm | null;
  timetableTerms?: TimetableTerm[];
  weeklyDraftBlocks?: WeeklyPlanDraftBlock[];
  onRemoveWeeklyDraftBlock?: (blockId: string) => void;
  onChangeDay: (date: string) => void;
  onEditPlan: (plan: Plan) => void;
  onMovePlan: (plan: Plan, target: WeekPlanMoveTarget) => Promise<void>;
  onDeletePlan: (plan: Plan) => Promise<void>;
  onSavePlan: (draft: PlanDraft, targetPlanId?: string) => Promise<void>;
  onSaveActual: (plan: Plan, draft: ActualDraft, targetActualId?: string) => Promise<void>;
  onSaveStandaloneActual: (draft: ActualDraft, targetActualId?: string) => Promise<void>;
  onLinkStandaloneActualToPlan: (actual: Actual, plan: Plan) => Promise<void>;
  onDeleteActual: (actual: Actual) => Promise<void>;
  onOpenBookshelf: () => void;
  onOpenAddMaterial: () => void;
}

type DayViewModalState =
  | { type: 'closed' }
  | { type: 'plan-detail'; planId: string }
  | { type: 'month-event-detail'; monthEventId: string }
  | { type: 'standalone-actual-detail'; actualId: string };

function createMonthEventActualPlan(
  monthEvent: MonthEvent,
  userId: string,
  occurrenceDate: string,
): Plan {
  const memoParts = [
    monthEvent.memo.trim(),
    monthEvent.locationTags.length > 0
      ? `場所タグ: ${monthEvent.locationTags.join(', ')}`
      : '',
    monthEvent.url.trim() ? `URL: ${monthEvent.url.trim()}` : '',
  ].filter(Boolean);

  return {
    id: monthEvent.id,
    seriesId: monthEvent.id,
    userId,
    title: monthEvent.title,
    subject: '主要予定',
    date: occurrenceDate,
    startTime: monthEvent.startTime,
    endTime: monthEvent.endTime,
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'other',
    memo: memoParts.join('\n'),
    createdAt: monthEvent.createdAt,
    updatedAt: monthEvent.updatedAt,
    sourceType: 'manual',
    sourceId: monthEvent.id,
    occurrenceDate,
  };
}

export function DayView({
  selectedDate,
  userId,
  plans,
  actuals,
  monthEvents,
  studySubjects,
  studyMaterials,
  scheduleTemplates,
  timetableTermId,
  timetableTerm,
  timetableTerms = [],
  weeklyDraftBlocks = [],
  onRemoveWeeklyDraftBlock,
  onChangeDay,
  onEditPlan,
  onMovePlan,
  onDeletePlan,
  onSavePlan,
  onSaveActual,
  onSaveStandaloneActual,
  onLinkStandaloneActualToPlan,
  onDeleteActual,
  onOpenBookshelf,
  onOpenAddMaterial,
}: DayViewProps) {
  const [modalState, setModalState] = useState<DayViewModalState>({ type: 'closed' });
  const [quickMaterial, setQuickMaterial] = useState<StudyMaterial | null>(null);
  const [isTimetableImportOpen, setIsTimetableImportOpen] = useState(false);
  const dayRangeLabel = formatDateLabel(selectedDate);
  const swipeNavigation = useSwipeNavigation({
    onPrevious: () => onChangeDay(addDays(selectedDate, -1)),
    onNext: () => onChangeDay(addDays(selectedDate, 1)),
    disabled: modalState.type !== 'closed',
  });
  const dayScheduleProjection = useMemo(
    () =>
      createScheduleOccurrenceProjection({
        ownerId: userId,
        startDate: selectedDate,
        endDate: selectedDate,
        plans,
        monthEvents,
      }),
    [monthEvents, plans, selectedDate, userId],
  );
  const dayPlans = useMemo(
    () => sortByDateTime(expandPlansForDate(plans, selectedDate)),
    [plans, selectedDate],
  );
  const monthEventById = useMemo(
    () => new Map(monthEvents.map((monthEvent) => [monthEvent.id, monthEvent])),
    [monthEvents],
  );
  const dayMonthEventOccurrences = useMemo(
    () =>
      dayScheduleProjection.occurrences.filter(
        (occurrence) => occurrence.source.backingKind === 'month-event',
      ),
    [dayScheduleProjection.occurrences],
  );
  const dayMonthEvents = useMemo(
    () =>
      sortMonthEvents(
        dayMonthEventOccurrences.flatMap((occurrence) => {
          const monthEvent = monthEventById.get(occurrence.source.backingId);
          if (!monthEvent) return [];
          return [
            {
              ...monthEvent,
              date: selectedDate,
              endDate: selectedDate,
              startTime:
                occurrence.start.date === selectedDate
                  ? occurrence.start.time
                  : '00:00',
              endTime:
                occurrence.end.date === selectedDate
                  ? occurrence.end.time
                  : '24:00',
              repeat: 'none' as const,
              repeatUntil: null,
              excludedDates: [],
            },
          ];
        }),
      ),
    [dayMonthEventOccurrences, monthEventById, selectedDate],
  );
  const dayMonthEventPlans = useMemo(
    () =>
      dayMonthEvents.map((monthEvent) =>
        createMonthEventActualPlan(monthEvent, userId, selectedDate),
      ),
    [dayMonthEvents, selectedDate, userId],
  );
  const dayOccurrenceKeys = useMemo(
    () =>
      new Set(
        [...dayPlans, ...dayMonthEventPlans].map((plan) =>
          buildPlanOccurrenceKey(plan.id, plan.date),
        ),
      ),
    [dayMonthEventPlans, dayPlans],
  );
  const dayPlanMap = useMemo(
    () => new Map(dayPlans.map((plan) => [plan.id, plan])),
    [dayPlans],
  );
  const dayMonthEventPlanMap = useMemo(
    () => new Map(dayMonthEventPlans.map((plan) => [plan.id, plan])),
    [dayMonthEventPlans],
  );
  const dayActuals = useMemo(
    () =>
      actuals.filter(
        (actual) =>
          dayOccurrenceKeys.has(getActualOccurrenceKey(actual)) ||
          (!actual.planId && actual.occurrenceDate === selectedDate),
      ),
    [actuals, dayOccurrenceKeys, selectedDate],
  );
  const dayMonthEventMap = useMemo(
    () =>
      new Map(
        dayMonthEventOccurrences.flatMap((occurrence) => {
          const monthEvent = monthEventById.get(occurrence.source.backingId);
          return monthEvent ? [[monthEvent.id, monthEvent] as const] : [];
        }),
      ),
    [dayMonthEventOccurrences, monthEventById],
  );
  const selectedWeekday = getRecurrenceWeekday(selectedDate);
  const resolvedTimetableTerm = useMemo(
    () =>
      timetableTerms.length > 0
        ? resolveTimetableTermForDate(selectedDate, timetableTerms, timetableTermId)
        : timetableTerm ?? null,
    [selectedDate, timetableTerm, timetableTermId, timetableTerms],
  );
  const resolvedTimetableTermId =
    resolvedTimetableTerm?.id ?? (timetableTerms.length === 0 ? timetableTermId : null);
  const timetableImportCandidates = useMemo(
    () =>
      resolvedTimetableTermId
        ? buildTimetableImportCandidates({
            templates: scheduleTemplates,
            date: selectedDate,
            weekday: selectedWeekday,
            termId: resolvedTimetableTermId,
            term: resolvedTimetableTerm,
          })
        : [],
    [
      resolvedTimetableTerm,
      resolvedTimetableTermId,
      scheduleTemplates,
      selectedDate,
      selectedWeekday,
    ],
  );
  const importedTimetableSourceIds = useMemo(
    () =>
      new Set(
        plans
          .filter(
            (plan) =>
              plan.date === selectedDate &&
              plan.sourceType === 'timetable' &&
              typeof plan.sourceId === 'string',
          )
          .map((plan) => plan.sourceId as string),
      ),
    [plans, selectedDate],
  );
  const actualByOccurrenceKey = useMemo(
    () => new Map(dayActuals.map((actual) => [getActualOccurrenceKey(actual), actual])),
    [dayActuals],
  );
  const selectedPlan =
    modalState.type === 'plan-detail'
      ? dayPlanMap.get(modalState.planId) ?? null
      : null;
  const selectedMonthEvent =
    modalState.type === 'month-event-detail'
      ? dayMonthEventMap.get(modalState.monthEventId) ?? null
      : null;
  const selectedMonthEventPlan = selectedMonthEvent
    ? dayMonthEventPlanMap.get(selectedMonthEvent.id) ?? null
    : null;
  const selectedDetailPlan = selectedPlan ?? selectedMonthEventPlan;
  const selectedDetailActual = selectedDetailPlan
    ? actualByOccurrenceKey.get(
        buildPlanOccurrenceKey(selectedDetailPlan.id, selectedDetailPlan.date),
      )
    : undefined;
  const selectedStandaloneActual =
    modalState.type === 'standalone-actual-detail'
      ? dayActuals.find(
          (actual) => actual.id === modalState.actualId && !actual.planId,
        ) ?? null
      : null;

  useEffect(() => {
    if (modalState.type === 'plan-detail' && !dayPlanMap.has(modalState.planId)) {
      setModalState({ type: 'closed' });
    }

    if (
      modalState.type === 'month-event-detail' &&
      !dayMonthEventMap.has(modalState.monthEventId)
    ) {
      setModalState({ type: 'closed' });
    }

    if (
      modalState.type === 'standalone-actual-detail' &&
      !dayActuals.some(
        (actual) => actual.id === modalState.actualId && !actual.planId,
      )
    ) {
      setModalState({ type: 'closed' });
    }
  }, [dayActuals, dayMonthEventMap, dayPlanMap, modalState]);

  useEffect(() => {
    setModalState({ type: 'closed' });
    setQuickMaterial(null);
  }, [selectedDate]);

  function closeModal() {
    setModalState({ type: 'closed' });
  }

  return (
    <section className="section-stack swipe-view" {...swipeNavigation}>
      <DayDetailModal
        detailPlan={selectedDetailPlan}
        monthEvent={selectedMonthEvent}
        detailActual={selectedDetailActual}
        standaloneActual={selectedStandaloneActual}
        plans={plans}
        actuals={actuals}
        onEditPlan={onEditPlan}
        onDeletePlan={onDeletePlan}
        onSaveActual={onSaveActual}
        onSaveStandaloneActual={onSaveStandaloneActual}
        onLinkStandaloneActualToPlan={onLinkStandaloneActualToPlan}
        onDeleteActual={onDeleteActual}
        onClose={closeModal}
      />

      {quickMaterial ? (
        <MaterialQuickCreateModal
          userId={userId}
          selectedDate={selectedDate}
          material={quickMaterial}
          onClose={() => setQuickMaterial(null)}
          onSavePlan={onSavePlan}
          onSaveStandaloneActual={onSaveStandaloneActual}
        />
      ) : null}

      <DayTimetableImportDialog
        open={isTimetableImportOpen}
        dateLabel={dayRangeLabel}
        selectedDate={selectedDate}
        userId={userId}
        candidates={timetableImportCandidates}
        importedSourceIds={importedTimetableSourceIds}
        onSavePlan={onSavePlan}
        onClose={() => setIsTimetableImportOpen(false)}
      />

      <DayTimeline
        dateLabel={dayRangeLabel}
        plans={dayPlans}
        monthEvents={dayMonthEvents}
        actuals={dayActuals}
        weeklyDraftBlocks={weeklyDraftBlocks.filter(
          (block) => block.date === selectedDate && block.status === 'draft',
        )}
        onRemoveWeeklyDraftBlock={onRemoveWeeklyDraftBlock}
        onMovePlan={onMovePlan}
        selectedEntryId={
          selectedPlan
            ? `plan:${selectedPlan.id}`
            : selectedMonthEvent
              ? `month-event:${selectedMonthEvent.id}`
              : selectedStandaloneActual
                ? `standalone-actual:${selectedStandaloneActual.id}`
                : undefined
        }
        onSelectEntry={(entry) =>
          entry.kind === 'standalone-actual'
            ? setModalState({ type: 'standalone-actual-detail', actualId: entry.id })
            : setModalState(
                entry.kind === 'plan'
                  ? { type: 'plan-detail', planId: entry.id }
                  : { type: 'month-event-detail', monthEventId: entry.id },
              )
        }
        onPreviousDay={() => onChangeDay(addDays(selectedDate, -1))}
        onNextDay={() => onChangeDay(addDays(selectedDate, 1))}
        onPrint={() => window.print()}
        onImportTimetable={() => setIsTimetableImportOpen(true)}
        timetableImportCount={timetableImportCandidates.length}
      />

      <DailyMaterialShelf
        userId={userId}
        subjects={studySubjects}
        materials={studyMaterials}
        onOpenBookshelf={onOpenBookshelf}
        onOpenAddMaterial={onOpenAddMaterial}
        onSelectMaterial={setQuickMaterial}
      />
    </section>
  );
}
