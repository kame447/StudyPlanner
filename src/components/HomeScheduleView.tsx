import type { StudyProgressPreferences } from '../lib/studyProgressPolicy';
import type { HomeAddEntry } from './home/TodayScheduleAddMenu';
import { useHomeDisplayClock } from './home/HomeDisplayClockContext';
import type { HomeScenePreferences } from '../lib/homeScenePreferences';
import { useMemo, type RefObject } from 'react';
import { toIsoDate } from '../lib/date';
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
  progressPreferences?: StudyProgressPreferences;
  homeScenePreferences?: HomeScenePreferences;
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
  onAddEntry: (entry: HomeAddEntry) => void;
  onOpenDay: (date: string) => void;
  onOpenTodo: () => void;
  onOpenBookshelf: () => void;
  onOpenReport: () => void;
}

export function HomeScheduleView({
  progressPreferences,
  homeScenePreferences,
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
  onAddEntry,
  onOpenDay,
  onOpenTodo,
  onOpenBookshelf,
  onOpenReport,
}: HomeScheduleViewProps) {
  const today = toIsoDate(useHomeDisplayClock());
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
        startDate: today,
      }),
    [
      monthEvents,
      plans,
      scheduleTemplates,
      timetableTerm,
      timetableTermId,
      timetableTerms,
      userId,
      today,
    ],
  );

  return (
    <HomeView key={userId}
      progressPreferences={progressPreferences}
      homeScenePreferences={homeScenePreferences}
      plans={displayPlans}
      actuals={actuals}
      monthEvents={monthEvents}
      todos={todos}
      studyMaterials={studyMaterials}
      primaryHeaderRef={primaryHeaderRef}
      primaryBottomNavRef={primaryBottomNavRef}
      onOpenAiPlanning={onOpenAiPlanning}
      onOpenSchedule={onOpenSchedule}
      onAddEntry={onAddEntry}
      onOpenDay={onOpenDay}
      onOpenTodo={onOpenTodo}
      onOpenBookshelf={onOpenBookshelf}
      onOpenReport={onOpenReport}
    />
  );
}
