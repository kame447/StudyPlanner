import { minutesFromTime } from '../../../lib/date';
import type { WeeklyPlanDraftBlock } from '../types';
import type {
  AvailabilitySlot,
  PlacementScoreComponents,
  WeeklyPlanningDefaultConditions,
  WeeklyPlanningQualityPreference,
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

export interface PlacementRank {
  hardViolationCount: number;
  sameDayTitleReentryCount: number;
  sameTitleRunIncrease: number;
  tinyChunkViolationCount: number;
  unexplainedSameTitleGapMinutes: number;
  subjectSwitchCount: number;
  dailyLoadDistance: number;
  preferredDateViolation: number;
  fallbackCount: number;
  softScore: number;
}

export function makeDateTitleKey(date: string, title: string): string {
  return `${date}::${title}`;
}

function roundToCandidateStep(minutes: number, stepMinutes = 10): number {
  return Math.round(minutes / stepMinutes) * stepMinutes;
}

function isCandidateInsideSlot(params: {
  candidate: number;
  slot: AvailabilitySlot;
  durationMinutes: number;
  minStudyBlockMinutes: number;
}): boolean {
  const latestStartMinutes = params.slot.endMinutes - params.durationMinutes;

  if (
    params.candidate < params.slot.startMinutes ||
    params.candidate > latestStartMinutes
  ) {
    return false;
  }

  const beforeMinutes = params.candidate - params.slot.startMinutes;
  const afterMinutes =
    params.slot.endMinutes - (params.candidate + params.durationMinutes);

  return (
    (beforeMinutes === 0 || beforeMinutes >= params.minStudyBlockMinutes) &&
    (afterMinutes === 0 || afterMinutes >= params.minStudyBlockMinutes)
  );
}

function addCandidate(params: {
  candidates: Set<number>;
  candidate: number;
  slot: AvailabilitySlot;
  durationMinutes: number;
  minStudyBlockMinutes: number;
  stepMinutes?: number;
}): void {
  const roundedCandidate = roundToCandidateStep(
    params.candidate,
    params.stepMinutes,
  );

  if (
    isCandidateInsideSlot({
      candidate: roundedCandidate,
      slot: params.slot,
      durationMinutes: params.durationMinutes,
      minStudyBlockMinutes: params.minStudyBlockMinutes,
    })
  ) {
    params.candidates.add(roundedCandidate);
  }
}

function blockIdentityMatches(params: {
  block: WeeklyPlanDraftBlock;
  title: string;
  subject?: string;
  label?: string;
  strictTitle?: boolean;
}): boolean {
  if (params.strictTitle) {
    return params.block.title === params.title;
  }

  return (
    params.block.title === params.title ||
    (!!params.subject && params.block.subject === params.subject) ||
    (!!params.label && params.block.label === params.label)
  );
}

function addAdjacencyCandidates(params: {
  candidates: Set<number>;
  slot: AvailabilitySlot;
  durationMinutes: number;
  dateBlocks: WeeklyPlanDraftBlock[];
  title: string;
  subject?: string;
  label?: string;
  breakMinutes: number;
  minStudyBlockMinutes: number;
  strictTitle?: boolean;
}): void {
  params.dateBlocks.forEach((block) => {
    if (
      !blockIdentityMatches({
        block,
        title: params.title,
        subject: params.subject,
        label: params.label,
        strictTitle: params.strictTitle,
      })
    ) {
      return;
    }

    const blockStart = minutesFromTime(block.startTime);
    const blockEnd = minutesFromTime(block.endTime);

    [
      blockEnd + params.breakMinutes,
      blockStart - params.breakMinutes - params.durationMinutes,
    ].forEach((candidate) =>
      addCandidate({
        candidates: params.candidates,
        candidate,
        slot: params.slot,
        durationMinutes: params.durationMinutes,
        minStudyBlockMinutes: params.minStudyBlockMinutes,
      }),
    );
  });
}

function countSubjectSwitchesInSequence(
  sequence: Array<{ title: string; startMinutes: number }>,
): number {
  return sequence
    .slice()
    .sort((left, right) => left.startMinutes - right.startMinutes)
    .reduce((switches, block, index, sortedBlocks) => {
      if (index === 0) {
        return switches;
      }

      return sortedBlocks[index - 1].title === block.title
        ? switches
        : switches + 1;
    }, 0);
}

function countRunsForTitle(
  sequence: Array<{ title: string; startMinutes: number }>,
  title: string,
): number {
  let previousTitle: string | undefined;
  let runs = 0;

  sequence
    .slice()
    .sort((left, right) => left.startMinutes - right.startMinutes)
    .forEach((block) => {
      if (block.title === title && previousTitle !== title) {
        runs += 1;
      }

      previousTitle = block.title;
    });

  return runs;
}

function hasTitleReentry(
  sequence: Array<{ title: string; startMinutes: number }>,
  title: string,
): boolean {
  return countRunsForTitle(sequence, title) > 1;
}

function calculateUnexplainedSameTitleGapMinutes(params: {
  dateBlocks: WeeklyPlanDraftBlock[];
  title: string;
  startMinutes: number;
  endMinutes: number;
  defaults: WeeklyPlanningDefaultConditions;
}): number {
  const sameTitleBlocks = [
    ...params.dateBlocks
      .filter((block) => block.title === params.title)
      .map((block) => ({
        startMinutes: minutesFromTime(block.startTime),
        endMinutes: minutesFromTime(block.endTime),
      })),
    { startMinutes: params.startMinutes, endMinutes: params.endMinutes },
  ].sort((left, right) => left.startMinutes - right.startMinutes);

  return sameTitleBlocks.reduce((total, block, index) => {
    if (index === 0) {
      return total;
    }

    const previous = sameTitleBlocks[index - 1];
    const gapMinutes = block.startMinutes - previous.endMinutes;

    if (gapMinutes <= params.defaults.breakMinutes) {
      return total;
    }

    if (
      intervalOverlapsUnavailableRange(
        params.defaults,
        previous.endMinutes,
        block.startMinutes,
      )
    ) {
      return total;
    }

    return total + gapMinutes - params.defaults.breakMinutes;
  }, 0);
}

export function comparePlacementRank(
  left: PlacementRank,
  right: PlacementRank,
): number {
  const fields: Array<keyof PlacementRank> = [
    'hardViolationCount',
    'preferredDateViolation',
    'dailyLoadDistance',
    'tinyChunkViolationCount',
    'sameDayTitleReentryCount',
    'sameTitleRunIncrease',
    'unexplainedSameTitleGapMinutes',
    'subjectSwitchCount',
    'fallbackCount',
  ];

  for (const field of fields) {
    const delta = left[field] - right[field];

    if (delta !== 0) {
      return delta;
    }
  }

  return right.softScore - left.softScore;
}

export function createStartMinuteCandidatesForSlot(params: {
  slot: AvailabilitySlot;
  durationMinutes: number;
  defaults: WeeklyPlanningDefaultConditions;
  adjacentStartMinutes?: number;
  subjectAnchorMinutes?: number;
  dateBlocks?: WeeklyPlanDraftBlock[];
  title?: string;
  subject?: string;
  label?: string;
  breakMinutes?: number;
  minStudyBlockMinutes?: number;
  fallbackStepMinutes?: number;
}): number[] {
  const latestStartMinutes = params.slot.endMinutes - params.durationMinutes;
  const candidates = new Set<number>();
  const minStudyBlockMinutes =
    params.minStudyBlockMinutes ?? params.defaults.minStudyBlockMinutes;
  const breakMinutes = params.breakMinutes ?? params.defaults.breakMinutes;
  const add = (candidate: number) =>
    addCandidate({
      candidates,
      candidate,
      slot: params.slot,
      durationMinutes: params.durationMinutes,
      minStudyBlockMinutes,
    });

  add(params.slot.startMinutes);

  if (params.adjacentStartMinutes !== undefined) {
    add(params.adjacentStartMinutes);
  }

  if (params.title && params.dateBlocks) {
    addAdjacencyCandidates({
      candidates,
      slot: params.slot,
      durationMinutes: params.durationMinutes,
      dateBlocks: params.dateBlocks,
      title: params.title,
      subject: params.subject,
      label: params.label,
      breakMinutes,
      minStudyBlockMinutes,
      strictTitle: true,
    });
    addAdjacencyCandidates({
      candidates,
      slot: params.slot,
      durationMinutes: params.durationMinutes,
      dateBlocks: params.dateBlocks,
      title: params.title,
      subject: params.subject,
      label: params.label,
      breakMinutes,
      minStudyBlockMinutes,
      strictTitle: false,
    });

    const lastBlock = params.dateBlocks
      .slice()
      .sort(
        (left, right) =>
          minutesFromTime(right.endTime) - minutesFromTime(left.endTime),
      )[0];

    if (lastBlock) {
      add(minutesFromTime(lastBlock.endTime) + breakMinutes);
    }
  }

  if (params.subjectAnchorMinutes !== undefined) {
    [
      params.subjectAnchorMinutes,
      params.subjectAnchorMinutes - Math.floor(params.durationMinutes / 2),
      params.subjectAnchorMinutes - params.durationMinutes,
    ].forEach(add);
  }

  params.defaults.preferredStudyRanges.forEach((range) => {
    const preferredStart = minutesFromTime(range.startTime);
    const preferredEnd = minutesFromTime(range.endTime);

    [
      preferredStart,
      preferredEnd - params.durationMinutes,
      preferredStart - Math.floor(params.durationMinutes / 2),
    ].forEach(add);
  });

  const fallbackStepMinutes = params.fallbackStepMinutes ?? 15;

  for (
    let minute = params.slot.startMinutes;
    minute <= latestStartMinutes;
    minute += fallbackStepMinutes
  ) {
    addCandidate({
      candidates,
      candidate: minute,
      slot: params.slot,
      durationMinutes: params.durationMinutes,
      minStudyBlockMinutes,
      stepMinutes: fallbackStepMinutes,
    });
  }

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
  endMinutes: number;
  title: string;
  defaults: WeeklyPlanningDefaultConditions;
}): number {
  const previousBlock = findPreviousBlockBefore(
    params.dateBlocks,
    params.startMinutes,
  );
  let penalty = 0;

  if (previousBlock) {
    const previousEndMinutes = minutesFromTime(previousBlock.endTime);
    const gapMinutes = params.startMinutes - previousEndMinutes;

    if (
      gapMinutes > params.defaults.breakMinutes &&
      !intervalOverlapsUnavailableRange(
        params.defaults,
        previousEndMinutes,
        params.startMinutes,
      )
    ) {
      penalty -= (gapMinutes - params.defaults.breakMinutes) * 2;
    }
  }

  const unexplainedSameTitleGapMinutes = calculateUnexplainedSameTitleGapMinutes({
    dateBlocks: params.dateBlocks,
    title: params.title,
    startMinutes: params.startMinutes,
    endMinutes: params.endMinutes,
    defaults: params.defaults,
  });

  return penalty - unexplainedSameTitleGapMinutes * 3;
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
      endMinutes: params.endMinutes,
      title: params.session.title,
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


export function createPlacementRank(params: {
  session: WeeklyPlanningSessionBlock;
  date: string;
  startMinutes: number;
  endMinutes: number;
  components: PlacementScoreComponents;
  blocksByDate: Map<string, WeeklyPlanDraftBlock[]>;
  dayLoads: Map<string, number>;
  defaults: WeeklyPlanningDefaultConditions;
  targetDailyMinutes: number;
  qualityPreferences?: WeeklyPlanningQualityPreference[];
}): PlacementRank {
  const dateBlocks = params.blocksByDate.get(params.date) ?? [];
  const beforeSequence = dateBlocks.map((block) => ({
    title: block.title,
    startMinutes: minutesFromTime(block.startTime),
  }));
  const afterSequence = [
    ...beforeSequence,
    { title: params.session.title, startMinutes: params.startMinutes },
  ];
  const beforeRuns = countRunsForTitle(beforeSequence, params.session.title);
  const afterRuns = countRunsForTitle(afterSequence, params.session.title);
  const qualityPreferences = params.qualityPreferences ?? [];
  const tinyChunkViolationCount =
    params.session.durationMinutes < params.session.minimumUsefulSessionMinutes ||
    (qualityPreferences.includes('avoidTinyChunks') &&
      params.session.durationMinutes >= 30 &&
      params.session.durationMinutes < 40) ||
    (qualityPreferences.includes('avoidFragmentingHeavyTasks') &&
      isHeavyStudyTask(params.session) &&
      params.session.durationMinutes < 60)
      ? 1
      : 0;
  const nextDayLoad =
    (params.dayLoads.get(params.date) ?? 0) + params.session.durationMinutes;
  const subjectSwitchCount = countSubjectSwitchesInSequence(afterSequence);
  const qualitySwitchPenalty = qualityPreferences.includes('avoidSingleSubjectDay')
    ? Math.max(0, subjectSwitchCount - 2)
    : Math.max(0, subjectSwitchCount - 3);

  return {
    hardViolationCount: 0,
    sameDayTitleReentryCount: hasTitleReentry(afterSequence, params.session.title) ? 1 : 0,
    sameTitleRunIncrease: Math.max(
      0,
      afterRuns - beforeRuns - (beforeRuns === 0 ? 1 : 0),
    ),
    tinyChunkViolationCount,
    unexplainedSameTitleGapMinutes: calculateUnexplainedSameTitleGapMinutes({
      dateBlocks,
      title: params.session.title,
      startMinutes: params.startMinutes,
      endMinutes: params.endMinutes,
      defaults: params.defaults,
    }),
    subjectSwitchCount: subjectSwitchCount + qualitySwitchPenalty,
    dailyLoadDistance: Math.abs(nextDayLoad - params.targetDailyMinutes),
    preferredDateViolation:
      params.session.preferredDate && params.session.preferredDate !== params.date ? 1 : 0,
    fallbackCount:
      params.session.preferredDate && params.session.preferredDate !== params.date ? 1 : 0,
    softScore: sumPlacementScoreComponents(params.components),
  };
}
