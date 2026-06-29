import type { LifeConstraint, WeeklyPlanningIntakeContext } from './weeklyPlanningIntakeTypes';
import { splitIntakeSegments } from './weeklyPlanningTextParsing';

function formatHourTime(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export function parseConstraints(text: string, context: WeeklyPlanningIntakeContext): LifeConstraint[] {
  const constraints: LifeConstraint[] = [];

  for (const segment of splitIntakeSegments(text)) {
    const fixedStartMatch = segment.match(/(\d{1,2})\s*時(?:から)?/);
    const hasFixedEventKeyword = /授業|バイト|病院|ゼミ|外出|予定あり|予定がある/.test(segment);
    const isAmbiguousFixedEvent = /かも|かもしれ|たぶん|多分/.test(segment);

    if (hasFixedEventKeyword) {
      constraints.push({
        kind: 'fixed_event',
        date: context.selectedDate,
        start: fixedStartMatch ? formatHourTime(Number(fixedStartMatch[1])) : undefined,
        hardness: isAmbiguousFixedEvent ? 'soft' : 'hard',
        rawText: segment,
      });
      continue;
    }

    if (/今日は?\s*2\s*時.*寝/.test(segment)) {
      constraints.push({
        kind: 'sleep',
        date: context.selectedDate,
        end: '26:00',
        hardness: 'soft',
        rawText: segment,
      });
    }

    if (/お昼|昼|夜.*(?:読めない|使えない|あんま読めない)/.test(segment)) {
      constraints.push({
        kind: 'meal',
        hardness: 'soft',
        rawText: segment,
      });
    }

    if (/ご飯.*19\s*時.*済ま/.test(segment)) {
      constraints.push({
        kind: 'meal',
        date: context.selectedDate,
        end: '19:00',
        hardness: 'hard',
        rawText: segment,
      });
    }

    if (/風呂|お風呂/.test(segment)) {
      constraints.push({
        kind: 'bath',
        durationMinutes: 30,
        hardness: 'soft',
        rawText: segment,
      });
    }

    if (/寝る時間|寝る準備|就寝/.test(segment)) {
      constraints.push({
        kind: 'buffer',
        durationMinutes: 30,
        hardness: 'soft',
        rawText: segment,
      });
    }
  }

  return constraints;
}

export function hasExplicitNoFixedEvents(text: string): boolean {
  return splitIntakeSegments(text).some((segment) =>
    /(?:他の)?固定予定.*ない|(?:他の)?予定.*ない|用事.*ない/.test(segment),
  );
}

export function hasLifeConstraint(constraint: LifeConstraint): boolean {
  return constraint.kind !== 'fixed_event' && constraint.kind !== 'unavailable';
}

export function hasConfirmedFixedEvent(constraint: LifeConstraint): boolean {
  return constraint.kind === 'fixed_event' && constraint.hardness === 'hard';
}
