import type { AddFixedEventCommand, UpdateLifeConstraintCommand } from './weeklyPlanningCommandTypes';
import type { LifeConstraint, WeeklyPlanningIntakeContext } from './weeklyPlanningIntakeTypes';
import { parseClockTime, parseHour, formatHourTime } from './weeklyPlanningTimeParsing';
import { resolveUnavailableDate } from './weeklyPlanningUnavailableParsing';
import { splitIntakeSegments } from './weeklyPlanningTextParsing';

function parseFixedEvent(segment: string, context: WeeklyPlanningIntakeContext): LifeConstraint | undefined {
  const hasFixedEventKeyword = /\u6388\u696d|\u30d0\u30a4\u30c8|\u75c5\u9662|\u30bc\u30df|\u5916\u51fa|\u6b6f\u533b\u8005|\u4e88\u5b9a\u3042\u308a|\u4e88\u5b9a\u304c\u3042\u308b|\u4e88\u5b9a.*(?:\u5165\u3063\u305f|\u5897\u3048\u305f)/.test(segment);

  if (!hasFixedEventKeyword) {
    return undefined;
  }

  const isAmbiguousFixedEvent = /\u304b\u3082|\u304b\u3082\u3057\u308c|\u305f\u3076\u3093|\u591a\u5206|\u306a\u308a\u305d\u3046/.test(segment);
  const start = parseClockTime(segment);
  const resolvedDate = resolveUnavailableDate(segment, context);

  if (isAmbiguousFixedEvent) {
    return {
      kind: 'fixed_event',
      date: resolvedDate ?? context.selectedDate,
      start,
      hardness: 'soft',
      rawText: segment,
    };
  }

  if (!start) {
    return undefined;
  }

  return {
    kind: 'fixed_event',
    date: resolvedDate ?? context.selectedDate,
    start,
    durationMinutes: 60,
    hardness: 'hard',
    rawText: segment,
  };
}

function parseLifeConstraint(segment: string, context: WeeklyPlanningIntakeContext): LifeConstraint[] {
  const constraints: LifeConstraint[] = [];
  const hour = parseHour(segment);

  if (/\u4eca\u65e5\u306f?\s*2\s*\u6642.*\u5bdd/.test(segment)) {
    constraints.push({
      kind: 'sleep',
      date: context.selectedDate,
      end: '26:00',
      hardness: 'soft',
      rawText: segment,
    });
  }

  if (/\u304a\u663c|\u663c|\u591c.*(?:\u8aad\u3081\u306a\u3044|\u4f7f\u3048\u306a\u3044|\u3042\u3093\u307e\u8aad\u3081\u306a\u3044)/.test(segment)) {
    constraints.push({
      kind: 'meal',
      hardness: 'soft',
      rawText: segment,
    });
  }

  if (/\u3054\u98ef.*19\s*\u6642.*\u6e08\u307e/.test(segment)) {
    constraints.push({
      kind: 'meal',
      date: context.selectedDate,
      end: '19:00',
      hardness: 'hard',
      rawText: segment,
    });
  }

  if (/(?:\u3054\u98ef|\u5915\u98ef|\u5915\u98df|\u6669\u98ef|\u663c\u98ef|\u663c\u98df)/.test(segment) && hour !== undefined) {
    constraints.push({
      kind: 'meal',
      date: context.selectedDate,
      end: formatHourTime(hour),
      durationMinutes: 60,
      hardness: /\u307e\u3067/.test(segment) ? 'hard' : 'soft',
      rawText: segment,
    });
  }

  if ((/\u98a8\u5442|\u304a\u98a8\u5442/.test(segment)) && !/\u591c\u306b.*(?:\u98a8\u5442|\u304a\u98a8\u5442)/.test(segment)) {
    constraints.push({
      kind: 'bath',
      date: hour === undefined ? undefined : context.selectedDate,
      start: hour === undefined ? undefined : formatHourTime(hour),
      durationMinutes: 30,
      hardness: hour === undefined ? 'soft' : 'hard',
      rawText: segment,
    });
  }

  if (/\u5bdd\u308b\u6642\u9593|\u5bdd\u308b\u6e96\u5099|\u5c31\u5bdd/.test(segment)) {
    constraints.push({
      kind: hour === undefined ? 'buffer' : 'sleep',
      date: hour === undefined ? undefined : context.selectedDate,
      start: hour === undefined ? undefined : formatHourTime(hour),
      durationMinutes: hour === undefined ? 30 : undefined,
      hardness: hour === undefined ? 'soft' : 'hard',
      rawText: segment,
    });
  }

  if (/\u8d77\u304d\u308b\u6642\u9593|\u8d77\u5e8a/.test(segment) && hour !== undefined) {
    constraints.push({
      kind: 'sleep',
      date: context.selectedDate,
      end: formatHourTime(hour),
      hardness: 'hard',
      rawText: segment,
    });
  }

  return constraints;
}

export function parseConstraints(text: string, context: WeeklyPlanningIntakeContext): LifeConstraint[] {
  const constraints: LifeConstraint[] = [];

  for (const segment of splitIntakeSegments(text)) {
    const fixedEvent = parseFixedEvent(segment, context);

    if (fixedEvent) {
      constraints.push(fixedEvent);
      continue;
    }

    constraints.push(...parseLifeConstraint(segment, context));
  }

  return constraints;
}

export function hasExplicitNoFixedEvents(text: string): boolean {
  return splitIntakeSegments(text).some((segment) =>
    /(?:\u4ed6\u306e)?\u56fa\u5b9a\u4e88\u5b9a.*\u306a\u3044|(?:\u4ed6\u306e)?\u4e88\u5b9a.*\u306a\u3044|\u7528\u4e8b.*\u306a\u3044/.test(segment),
  );
}

export function hasLifeConstraint(constraint: LifeConstraint): boolean {
  return constraint.kind !== 'fixed_event' && constraint.kind !== 'unavailable';
}

export function hasConfirmedFixedEvent(constraint: LifeConstraint): boolean {
  return constraint.kind === 'fixed_event' && constraint.hardness === 'hard';
}
export function parseConstraintCommands(
  text: string,
  context: WeeklyPlanningIntakeContext,
): Array<AddFixedEventCommand | UpdateLifeConstraintCommand> {
  const commands: Array<AddFixedEventCommand | UpdateLifeConstraintCommand> = [];

  parseConstraints(text, context).forEach((constraint) => {
    if (constraint.kind === 'fixed_event') {
      commands.push({
        type: 'add_fixed_event',
        event: {
          date: constraint.date,
          start: constraint.start,
          end: constraint.end,
          durationMinutes: constraint.durationMinutes,
          hardness: constraint.hardness,
        },
        sourceText: text,
        sourceSegment: constraint.rawText,
        confidence: constraint.hardness === 'hard' ? 'high' : 'medium',
      });
      return;
    }

    if (constraint.kind === 'unavailable') {
      return;
    }

    commands.push({
      type: 'update_life_constraint',
      kind: constraint.kind,
      constraint: {
        date: constraint.date,
        start: constraint.start,
        end: constraint.end,
        durationMinutes: constraint.durationMinutes,
        hardness: constraint.hardness,
      },
      sourceText: text,
      sourceSegment: constraint.rawText,
      confidence: constraint.hardness === 'hard' ? 'high' : 'medium',
    });
  });

  return commands;
}