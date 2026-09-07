import { useMemo, type RefObject } from 'react';
import { todayIsoDate } from '../lib/date';
import { augmentHomePlansWithScheduleOccurrences } from '../lib/homeScheduleAugmentation';
import type {
  Actual,
  MonthEvent,
  Plan,
  ScheduleTemplate,
  StudyMaterial,
  TimetableTerm,
  TodoTask,
} from '../types/domain';
import { HomeView } from './HomeView';

interface HomeScheduleViewProps {
  userId: string;
  plans: Plan[];
  actuals: Actual[];
  monthEvents: MonthEvent[];
  todos: TodoTask[];
  studyMaterials: StudyMaterial[];
  scheduleTemplates: ScheduleTemplate[];
  timetableTermId: string;
  timetableTerm?: TimetableTerm | null;
  timetableTerms?: TimetableTerm[];
  primaryHeaderRef: RefObject<HTMLDivElement | null>;
  primaryBottomNavRef: RefObject<HTMLElement | null>;
  onOpenAiPlanning: () => void;
  onOpenSchedule: () => void;
  onOpenDay: (date: string) => void;
  onOpenTodo: () => void;
  onOpenBookshelf: () => void;
  onOpenReport: () => void;
}

export function HomeScheduleView({
  userId,
  plans,
  actuals,
  monthEvents,
  todos,
  studyMaterials,
  scheduleTemplates,
  timetableTermId,
  timetableTerm,
  timetableTerms = [],
  primaryHeaderRef,
  primaryBottomNavRef,
  onOpenAiPlanning,
  onOpenSchedule,
  onOpenDay,
  onOpenTodo,
  onOpenBookshelf,
  onOpenReport,
}: HomeScheduleViewProps) {
  const displayPlans = useMemo(
    () =>
      augmentHomePlansWithScheduleOccurrences({
        ownerId: userId,
        plans,
        monthEvents,
        scheduleTemplates,
        timetableTermId,
        timetableTerm,
        timetableTerms,
        startDate: todayIsoDate(),
      }),
    [
      monthEvents,
      plans,
      scheduleTemplates,
      timetableTerm,
      timetableTermId,
      timetableTerms,
      userId,
    ],
  );

  return (
    <HomeView
      plans={displayPlans}
      actuals={actuals}
      todos={todos}
      studyMaterials={studyMaterials}
      primaryHeaderRef={primaryHeaderRef}
      primaryBottomNavRef={primaryBottomNavRef}
      onOpenAiPlanning={onOpenAiPlanning}
      onOpenSchedule={onOpenSchedule}
      onOpenDay={onOpenDay}
      onOpenTodo={onOpenTodo}
      onOpenBookshelf={onOpenBookshelf}
      onOpenReport={onOpenReport}
    />
  );
}
