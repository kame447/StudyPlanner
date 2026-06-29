import { addDays } from '../../../lib/date';
import type { LifeConstraint } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningRemainingWorkItem } from '../intake/weeklyPlanningRemainingWorkItems';
import type { SessionLengthPolicy } from '../weeklyPlanningTypes';
import { splitDurationIntoSessionChunks } from './sessionChunking';

export interface WeeklyDraftCandidateSessionPolicy extends SessionLengthPolicy {
  dayStartTime: string;
  dayEndTime: string;
  firstDayStartTime?: string;
  breakMinutes: number;
}

export interface WeeklyDraftCandidateGeneratorInput {
  remainingWorkItems: WeeklyPlanningRemainingWorkItem[];
  constraints: LifeConstraint[];
  fixedEvents: LifeConstraint[];
  planningStartDate: string;
  planningDayCount: number;
  sessionPolicy?: Partial<WeeklyDraftCandidateSessionPolicy>;
}

export interface WeeklyDraftCandidate {
  stableKey: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  title: string;
  field: string;
  year: number;
  estimatedMinutes: number;
  source: 'weekly_exam_prep';
  approvalStatus: 'unapproved';
  workItemKey: string;
}

export interface WeeklyDraftCandidateConflict {
  workItemKey?: string;
  candidateKey?: string;
  constraintKind: LifeConstraint['kind'];
  date?: string;
  startTime?: string;
  endTime?: string;
  rawText?: string;
  reason: string;
}

export interface WeeklyDraftCandidateDiagnostics {
  totalRequestedMinutes: number;
  totalScheduledMinutes: number;
  unscheduledItems: WeeklyPlanningRemainingWorkItem[];
  constraintConflicts: WeeklyDraftCandidateConflict[];
  fixedEventConflicts: WeeklyDraftCandidateConflict[];
  lifeConstraintConflicts: WeeklyDraftCandidateConflict[];
  fieldOrderPreserved: boolean;
  completedYearsExcluded: boolean;
  deterministicKey: string;
  decisionTrace: string[];
  shouldSavePlan: false;
}

export interface WeeklyDraftCandidateGeneratorResult {
  candidates: WeeklyDraftCandidate[];
  diagnostics: WeeklyDraftCandidateDiagnostics;
}

interface BusyInterval {
  date: string;
  startMinutes: number;
  endMinutes: number;
  constraint: LifeConstraint;
}

const DEFAULT_SESSION_POLICY: WeeklyDraftCandidateSessionPolicy = {
  mode: 'deep_work',
  minSessionMinutes: 30,
  targetSessionMinutes: 120,
  maxSessionMinutes: 120,
  allowSmallRemainder: true,
  dayStartTime: '09:00',
  dayEndTime: '22:00',
  firstDayStartTime: undefined,
  breakMinutes: 10,
};

function minutesFromTime(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function timeFromMinutes(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function resolveSessionPolicy(
  override: Partial<WeeklyDraftCandidateSessionPolicy> | undefined,
): WeeklyDraftCandidateSessionPolicy {
  return {
    ...DEFAULT_SESSION_POLICY,
    ...override,
  };
}

function workItemKey(item: WeeklyPlanningRemainingWorkItem): string {
  return `${item.field}:${item.year}`;
}

function intervalsOverlap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): boolean {
  return leftStart < rightEnd && rightStart < leftEnd;
}

function constraintToBusyInterval(
  constraint: LifeConstraint,
  fallbackDate: string,
): BusyInterval | null {
  const date = constraint.date ?? fallbackDate;

  if (constraint.start && constraint.end) {
    return {
      date,
      startMinutes: minutesFromTime(constraint.start),
      endMinutes: minutesFromTime(constraint.end),
      constraint,
    };
  }

  if (constraint.start) {
    const startMinutes = minutesFromTime(constraint.start);
    return {
      date,
      startMinutes,
      endMinutes: startMinutes + (constraint.durationMinutes ?? 60),
      constraint,
    };
  }

  if (constraint.end && constraint.durationMinutes) {
    const endMinutes = minutesFromTime(constraint.end);
    return {
      date,
      startMinutes: endMinutes - constraint.durationMinutes,
      endMinutes,
      constraint,
    };
  }

  if (constraint.end && constraint.kind === 'meal') {
    const endMinutes = minutesFromTime(constraint.end);
    return {
      date,
      startMinutes: endMinutes - 60,
      endMinutes,
      constraint,
    };
  }

  return null;
}

function buildBusyIntervals(params: {
  constraints: LifeConstraint[];
  fixedEvents: LifeConstraint[];
  planningStartDate: string;
}): {
  intervals: BusyInterval[];
  floatingConstraints: LifeConstraint[];
} {
  const allConstraints = [...params.constraints, ...params.fixedEvents];
  const intervals: BusyInterval[] = [];
  const floatingConstraints: LifeConstraint[] = [];

  allConstraints.forEach((constraint) => {
    const interval = constraintToBusyInterval(constraint, params.planningStartDate);

    if (interval) {
      intervals.push(interval);
    } else {
      floatingConstraints.push(constraint);
    }
  });

  return { intervals, floatingConstraints };
}

function findNextSlot(params: {
  durationMinutes: number;
  cursorDateIndex: number;
  cursorMinutes: number;
  planningStartDate: string;
  planningDayCount: number;
  policy: WeeklyDraftCandidateSessionPolicy;
  busyIntervals: BusyInterval[];
}): { dateIndex: number; startMinutes: number; endMinutes: number } | null {
  for (let dateIndex = params.cursorDateIndex; dateIndex < params.planningDayCount; dateIndex += 1) {
    const date = addDays(params.planningStartDate, dateIndex);
    const dayStart = dateIndex === 0 && params.policy.firstDayStartTime
      ? minutesFromTime(params.policy.firstDayStartTime)
      : minutesFromTime(params.policy.dayStartTime);
    const dayEnd = minutesFromTime(params.policy.dayEndTime);
    let startMinutes = dateIndex === params.cursorDateIndex
      ? Math.max(params.cursorMinutes, dayStart)
      : dayStart;

    while (startMinutes + params.durationMinutes <= dayEnd) {
      const endMinutes = startMinutes + params.durationMinutes;
      const conflict = params.busyIntervals
        .filter((interval) => interval.date === date)
        .find((interval) => intervalsOverlap(startMinutes, endMinutes, interval.startMinutes, interval.endMinutes));

      if (!conflict) {
        return { dateIndex, startMinutes, endMinutes };
      }

      startMinutes = conflict.endMinutes;
    }
  }

  return null;
}

function createConflict(params: {
  interval: BusyInterval;
  candidate: WeeklyDraftCandidate;
}): WeeklyDraftCandidateConflict {
  return {
    candidateKey: params.candidate.stableKey,
    workItemKey: params.candidate.workItemKey,
    constraintKind: params.interval.constraint.kind,
    date: params.interval.date,
    startTime: timeFromMinutes(params.interval.startMinutes),
    endTime: timeFromMinutes(params.interval.endMinutes),
    rawText: params.interval.constraint.rawText,
    reason: 'candidate-overlaps-constraint',
  };
}

function candidateHasConflict(
  candidate: WeeklyDraftCandidate,
  intervals: BusyInterval[],
): WeeklyDraftCandidateConflict[] {
  const startMinutes = minutesFromTime(candidate.startTime);
  const endMinutes = minutesFromTime(candidate.endTime);

  return intervals
    .filter((interval) => interval.date === candidate.date)
    .filter((interval) => intervalsOverlap(startMinutes, endMinutes, interval.startMinutes, interval.endMinutes))
    .map((interval) => createConflict({ interval, candidate }));
}

function isFixedConstraint(kind: LifeConstraint['kind']): boolean {
  return kind === 'fixed_event' || kind === 'unavailable';
}

function createDeterministicKey(candidates: WeeklyDraftCandidate[]): string {
  return candidates
    .map((candidate) => `${candidate.stableKey}@${candidate.date}T${candidate.startTime}-${candidate.endTime}`)
    .join('|');
}

function isFieldOrderPreserved(params: {
  remainingWorkItems: WeeklyPlanningRemainingWorkItem[];
  candidates: WeeklyDraftCandidate[];
}): boolean {
  const expectedOrder = params.remainingWorkItems.map(workItemKey);
  const actualOrder = params.candidates.map((candidate) => candidate.workItemKey);
  let cursor = 0;

  for (const key of actualOrder) {
    while (cursor < expectedOrder.length && expectedOrder[cursor] !== key) {
      cursor += 1;
    }

    if (cursor >= expectedOrder.length) {
      return false;
    }
  }

  return true;
}

export function createWeeklyDraftCandidatesFromRemainingWorkItems(
  input: WeeklyDraftCandidateGeneratorInput,
): WeeklyDraftCandidateGeneratorResult {
  const policy = resolveSessionPolicy(input.sessionPolicy);
  const { intervals: busyIntervals, floatingConstraints } = buildBusyIntervals({
    constraints: input.constraints,
    fixedEvents: input.fixedEvents,
    planningStartDate: input.planningStartDate,
  });
  const candidates: WeeklyDraftCandidate[] = [];
  const unscheduledItems: WeeklyPlanningRemainingWorkItem[] = [];
  const decisionTrace = floatingConstraints.map(
    (constraint) => `floating-${constraint.kind}-constraint:${constraint.rawText ?? 'no-source'}`,
  );
  let cursorDateIndex = 0;
  let cursorMinutes = policy.firstDayStartTime
    ? minutesFromTime(policy.firstDayStartTime)
    : minutesFromTime(policy.dayStartTime);

  input.remainingWorkItems.forEach((item) => {
    const chunks = splitDurationIntoSessionChunks(item.estimatedMinutes, policy);
    const itemKey = workItemKey(item);
    let chunkIndex = 0;
    let itemFullyScheduled = true;

    for (const durationMinutes of chunks) {
      const slot = findNextSlot({
        durationMinutes,
        cursorDateIndex,
        cursorMinutes,
        planningStartDate: input.planningStartDate,
        planningDayCount: input.planningDayCount,
        policy,
        busyIntervals,
      });

      if (!slot) {
        itemFullyScheduled = false;
        break;
      }

      const date = addDays(input.planningStartDate, slot.dateIndex);
      const stableKey = `${itemKey}:chunk-${chunkIndex}`;
      candidates.push({
        stableKey,
        date,
        startTime: timeFromMinutes(slot.startMinutes),
        endTime: timeFromMinutes(slot.endMinutes),
        durationMinutes,
        title: `${item.field} ${item.year}年度`,
        field: item.field,
        year: item.year,
        estimatedMinutes: item.estimatedMinutes,
        source: 'weekly_exam_prep',
        approvalStatus: 'unapproved',
        workItemKey: itemKey,
      });
      cursorDateIndex = slot.dateIndex;
      cursorMinutes = slot.endMinutes + policy.breakMinutes;
      chunkIndex += 1;
    }

    if (!itemFullyScheduled) {
      unscheduledItems.push(item);
    }
  });

  const allConflicts = candidates.flatMap((candidate) => candidateHasConflict(candidate, busyIntervals));
  const fixedEventConflicts = allConflicts.filter((conflict) => isFixedConstraint(conflict.constraintKind));
  const lifeConstraintConflicts = allConflicts.filter((conflict) => !isFixedConstraint(conflict.constraintKind));
  const totalRequestedMinutes = input.remainingWorkItems.reduce(
    (sum, item) => sum + item.estimatedMinutes,
    0,
  );
  const totalScheduledMinutes = candidates.reduce(
    (sum, candidate) => sum + candidate.durationMinutes,
    0,
  );

  return {
    candidates,
    diagnostics: {
      totalRequestedMinutes,
      totalScheduledMinutes,
      unscheduledItems,
      constraintConflicts: allConflicts,
      fixedEventConflicts,
      lifeConstraintConflicts,
      fieldOrderPreserved: isFieldOrderPreserved({
        remainingWorkItems: input.remainingWorkItems,
        candidates,
      }),
      completedYearsExcluded: true,
      deterministicKey: createDeterministicKey(candidates),
      decisionTrace,
      shouldSavePlan: false,
    },
  };
}