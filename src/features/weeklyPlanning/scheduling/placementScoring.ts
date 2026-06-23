import { minutesFromTime } from '../../../lib/date';
import type { WeeklyPlanDraftBlock } from '../types';
import type {
  AvailabilitySlot,
  PlacementScoreComponents,
  WeeklyPlanningDefaultConditions,
  WeeklyPlanningSessionBlock,
} from '../weeklyPlanningTypes';
import { isHeavyStudyTask } from '../profiling/studyTaskProfile';
import { intersectInterval } from './availabilitySlots';

export function intervalOverlapsUnavailableRange(
  defaults: WeeklyPlanningDefaultConditions,
  startMinutes: number,
  endMinutes: number,
): boolean {
  return defaults.unavailableRanges.some((range) =>
    intersectInterval(
      { startMinutes, endMinutes },
      {
        startMinutes: minutesFromTime(range.startTime),
        endMinutes: minutesFromTime(range.endTime),
      },
    ),
  );
}

export function calculatePreferredOverlapMinutes(
  defaults: WeeklyPlanningDefaultConditions,
  startMinutes: number,
  endMinutes: number,
): number {
  return defaults.preferredStudyRanges.reduce((total, range) => {
    const preferredStart = minutesFromTime(range.startTime);
    const preferredEnd = minutesFromTime(range.endTime);
    const overlapStart = Math.max(startMinutes, preferredStart);
    const overlapEnd = Math.min(endMinutes, preferredEnd);

    return total + Math.max(0, overlapEnd - overlapStart);
  }, 0);
}

export function createStartMinuteCandidatesForSlot(params: {
  slot: AvailabilitySlot;
  durationMinutes: number;
  defaults: WeeklyPlanningDefaultConditions;
  adjacentStartMinutes?: number;
  subjectAnchorMinutes?: number;
}): number[] {
  const latestStartMinutes = params.slot.endMinutes - params.durationMinutes;
  const candidates = new Set<number>([params.slot.startMinutes]);

  if (
    params.adjacentStartMinutes !== undefined &&
    params.adjacentStartMinutes >= params.slot.startMinutes &&
    params.adjacentStartMinutes <= latestStartMinutes
  ) {
    candidates.add(params.adjacentStartMinutes);
  }

  if (params.subjectAnchorMinutes !== undefined) {
    [
      params.subjectAnchorMinutes,
      params.subjectAnchorMinutes - Math.floor(params.durationMinutes / 2),
      params.subjectAnchorMinutes - params.durationMinutes,
    ].forEach((candidate) => {
      const roundedCandidate = Math.round(candidate / 10) * 10;

      if (
        roundedCandidate >= params.slot.startMinutes &&
        roundedCandidate <= latestStartMinutes
      ) {
        candidates.add(roundedCandidate);
      }
    });
  }

  params.defaults.preferredStudyRanges.forEach((range) => {
    const preferredStart = minutesFromTime(range.startTime);
    const preferredEnd = minutesFromTime(range.endTime);
    const startAtPreferredStart = preferredStart;
    const startEndingAtPreferredEnd = preferredEnd - params.durationMinutes;
    const startCrossingPreferredStart =
      preferredStart - Math.floor(params.durationMinutes / 2);

    [
      startAtPreferredStart,
      startEndingAtPreferredEnd,
      startCrossingPreferredStart,
    ].forEach((candidate) => {
      const roundedCandidate = Math.round(candidate / 10) * 10;

      if (
        roundedCandidate >= params.slot.startMinutes &&
        roundedCandidate <= latestStartMinutes
      ) {
        candidates.add(roundedCandidate);
      }
    });
  });

  return Array.from(candidates).sort((left, right) => left - right);
}

function findPreviousBlockBefore(
  blocks: WeeklyPlanDraftBlock[],
  startMinutes: number,
): WeeklyPlanDraftBlock | undefined {
  return blocks
    .filter((block) => minutesFromTime(block.endTime) <= startMinutes)
    .sort(
      (left, right) =>
        minutesFromTime(right.endTime) - minutesFromTime(left.endTime),
    )[0];
}

function calculateSubjectAnchorBonus(params: {
  startMinutes: number;
  endMinutes: number;
  subjectAnchorMinutes?: number;
}): number {
  if (params.subjectAnchorMinutes === undefined) {
    return 0;
  }

  const midpoint = (params.startMinutes + params.endMinutes) / 2;
  const distance = Math.abs(midpoint - params.subjectAnchorMinutes);

  return Math.max(-90, 110 - distance / 2);
}

function isAdjacentToSameSubject(params: {
  dateBlocks: WeeklyPlanDraftBlock[];
  title: string;
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
}): boolean {
  return params.dateBlocks.some((block) => {
    if (block.title !== params.title) {
      return false;
    }

    const blockStart = minutesFromTime(block.startTime);
    const blockEnd = minutesFromTime(block.endTime);

    return (
      Math.abs(blockEnd + params.breakMinutes - params.startMinutes) <= 5 ||
      Math.abs(params.endMinutes + params.breakMinutes - blockStart) <= 5
    );
  });
}

function calculateSameDaySequenceComponents(params: {
  dateBlocks: WeeklyPlanDraftBlock[];
  title: string;
  startMinutes: number;
  endMinutes: number;
}): Pick<
  PlacementScoreComponents,
  'sameDayFragmentationPenalty' | 'subjectSwitchPenalty'
> {
  const sequence = [
    ...params.dateBlocks.map((block) => ({
      title: block.title,
      startMinutes: minutesFromTime(block.startTime),
      endMinutes: minutesFromTime(block.endTime),
    })),
    {
      title: params.title,
      startMinutes: params.startMinutes,
      endMinutes: params.endMinutes,
    },
  ].sort((left, right) => left.startMinutes - right.startMinutes);
  const titles = sequence.map((block) => block.title);
  const uniqueTitleCount = new Set(titles).size;
  let switches = 0;
  const runsByTitle = new Map<string, number>();
  let previousTitle: string | undefined;

  titles.forEach((title) => {
    if (previousTitle !== undefined && previousTitle !== title) {
      switches += 1;
    }

    if (previousTitle !== title) {
      runsByTitle.set(title, (runsByTitle.get(title) ?? 0) + 1);
    }

    previousTitle = title;
  });

  const fragmentationCount = Array.from(runsByTitle.values()).reduce(
    (total, runs) => total + Math.max(0, runs - 1),
    0,
  );
  const naturalSwitches = Math.max(0, uniqueTitleCount - 1);
  const excessiveSwitches = Math.max(0, switches - naturalSwitches);

  return {
    sameDayFragmentationPenalty: -fragmentationCount * 140,
    subjectSwitchPenalty: -excessiveSwitches * 70,
  };
}

function calculateHeavyTaskLatePenalty(params: {
  session: WeeklyPlanningSessionBlock;
  startMinutes: number;
  endMinutes: number;
}): number {
  if (!isHeavyStudyTask(params.session)) {
    return 0;
  }

  const lateStartMinutes = 22 * 60;
  const lateMinutes = Math.max(0, params.endMinutes - Math.max(params.startMinutes, lateStartMinutes));

  return -lateMinutes * 3;
}

function calculateCompactnessPenalty(params: {
  dateBlocks: WeeklyPlanDraftBlock[];
  startMinutes: number;
  defaults: WeeklyPlanningDefaultConditions;
}): number {
  const previousBlock = findPreviousBlockBefore(params.dateBlocks, params.startMinutes);

  if (!previousBlock) {
    return 0;
  }

  const previousEndMinutes = minutesFromTime(previousBlock.endTime);
  const gapMinutes = params.startMinutes - previousEndMinutes;

  if (gapMinutes <= params.defaults.breakMinutes) {
    return 0;
  }

  if (intervalOverlapsUnavailableRange(params.defaults, previousEndMinutes, params.startMinutes)) {
    return 0;
  }

  return -(gapMinutes - params.defaults.breakMinutes) * 2;
}

export function sumPlacementScoreComponents(components: PlacementScoreComponents): number {
  return (
    components.preferredWindowBonus +
    components.dailyLoadPenalty +
    components.sameTaskPenalty +
    components.subjectSpreadBonus +
    components.compactnessPenalty +
    components.explicitOverrideBonus +
    components.preferredDateBonus +
    components.fallbackPenalty +
    components.subjectAnchorBonus +
    components.sameDayFragmentationPenalty +
    components.subjectSwitchPenalty +
    components.heavyTaskLatePenalty
  );
}

export function calculatePlacementScoreComponents(params: {
  session: WeeklyPlanningSessionBlock;
  date: string;
  startMinutes: number;
  endMinutes: number;
  blocksByDate: Map<string, WeeklyPlanDraftBlock[]>;
  dayLoads: Map<string, number>;
  defaults: WeeklyPlanningDefaultConditions;
  targetDailyMinutes: number;
  subjectAnchorMinutesByTitle: Map<string, number>;
}): PlacementScoreComponents {
  const dateBlocks = params.blocksByDate.get(params.date) ?? [];
  const sameTaskCount = dateBlocks.filter(
    (block) => block.title === params.session.title,
  ).length;
  const nextDayLoad = (params.dayLoads.get(params.date) ?? 0) + params.session.durationMinutes;
  const dailyLoadDistance = Math.abs(nextDayLoad - params.targetDailyMinutes);
  const preferredOverlapMinutes = calculatePreferredOverlapMinutes(
    params.defaults,
    params.startMinutes,
    params.endMinutes,
  );
  const isPreferredDate = params.session.preferredDate === params.date;
  const isExplicitOverride = Boolean(params.session.sessionIntentKind);
  const subjectAnchorMinutes = params.subjectAnchorMinutesByTitle.get(params.session.title);
  const isAdjacentSameSubject = isAdjacentToSameSubject({
    dateBlocks,
    title: params.session.title,
    startMinutes: params.startMinutes,
    endMinutes: params.endMinutes,
    breakMinutes: params.defaults.breakMinutes,
  });
  const sequenceComponents = calculateSameDaySequenceComponents({
    dateBlocks,
    title: params.session.title,
    startMinutes: params.startMinutes,
    endMinutes: params.endMinutes,
  });

  return {
    preferredWindowBonus: preferredOverlapMinutes,
    dailyLoadPenalty: -dailyLoadDistance / 3,
    sameTaskPenalty: params.session.consolidationIntent
      ? 0
      : sameTaskCount === 0
        ? 0
        : isAdjacentSameSubject
          ? -10
          : -sameTaskCount * 65,
    subjectSpreadBonus: sameTaskCount === 0 ? 35 : isAdjacentSameSubject ? 20 : 0,
    compactnessPenalty: calculateCompactnessPenalty({
      dateBlocks,
      startMinutes: params.startMinutes,
      defaults: params.defaults,
    }),
    explicitOverrideBonus: isExplicitOverride ? 35 : 0,
    preferredDateBonus: isPreferredDate ? 220 : 0,
    fallbackPenalty: params.session.preferredDate && !isPreferredDate ? -120 : 0,
    subjectAnchorBonus: calculateSubjectAnchorBonus({
      startMinutes: params.startMinutes,
      endMinutes: params.endMinutes,
      subjectAnchorMinutes,
    }),
    sameDayFragmentationPenalty: sequenceComponents.sameDayFragmentationPenalty,
    subjectSwitchPenalty: sequenceComponents.subjectSwitchPenalty,
    heavyTaskLatePenalty: calculateHeavyTaskLatePenalty({
      session: params.session,
      startMinutes: params.startMinutes,
      endMinutes: params.endMinutes,
    }),
  };
}
