import type { SetUnitRateCommand } from './weeklyPlanningCommandTypes';
import type { ExamPrepScope, UnitRateEstimate } from './weeklyPlanningIntakeTypes';
import { parseSmallInteger, splitIntakeSegments } from './weeklyPlanningTextParsing';

type ParsedUnitRateEstimate = UnitRateEstimate & {
  minutesPerUnit: number;
};

function buildYearFieldUnitRate(
  match: RegExpMatchArray,
  segment: string,
): ParsedUnitRateEstimate | undefined {
  const hours = parseSmallInteger(match[1]);

  if (!hours) {
    return undefined;
  }

  return {
    unit: 'year_field_chunk',
    minutesPerUnit: hours * 60,
    source: 'user',
    uncertainty: /くらい|ぐらい|だいたい/.test(segment) ? 'medium' : 'low',
    rawText: match[0],
  };
}

export function parseBareDurationAsUnitRateCommand(
  text: string,
): SetUnitRateCommand | undefined {
  for (const segment of splitIntakeSegments(text)) {
    const match = segment.match(
      /^(?:だいたい\s*)?([0-9]+|[一二三四五六七八九十]+)\s*時間\s*(?:くらい|ぐらい)?\s*(?:です|かな|だね|ですね)?$/,
    );

    if (!match) {
      continue;
    }

    const hours = parseSmallInteger(match[1]);

    if (!hours) {
      continue;
    }

    const uncertainty = /くらい|ぐらい|だいたい|かな/.test(segment) ? 'medium' : 'low';
    const unitRate: ParsedUnitRateEstimate = {
      unit: 'year_field_chunk',
      minutesPerUnit: hours * 60,
      source: 'user',
      uncertainty,
      rawText: match[0],
    };

    return {
      type: 'set_unit_rate',
      unitRate,
      sourceText: text,
      sourceSegment: unitRate.rawText,
      confidence: uncertainty === 'medium' ? 'medium' : 'high',
    };
  }

  return undefined;
}

export function parseUnitRate(
  text: string,
  examPrepScope: ExamPrepScope | undefined,
): ParsedUnitRateEstimate | undefined {
  for (const segment of splitIntakeSegments(text)) {
    const explicitYearFieldMatch = segment.match(
      /(?:1|一)\s*分野(?:の)?\s*(?:1|一)\s*年分.*?([0-9]+|[一二三四五六七八九十]+)\s*時間/,
    );

    if (explicitYearFieldMatch) {
      return buildYearFieldUnitRate(explicitYearFieldMatch, segment);
    }

    if (examPrepScope?.unitModel !== 'year_field_chunk') {
      continue;
    }

    const contextualYearMatch = segment.match(
      /(?:1|一)?\s*年分(?:は|が|で|に)?\s*([0-9]+|[一二三四五六七八九十]+)\s*時間/,
    );

    if (contextualYearMatch) {
      return buildYearFieldUnitRate(contextualYearMatch, segment);
    }
  }

  return undefined;
}

export function parseSetUnitRateCommand(
  text: string,
  examPrepScope: ExamPrepScope | undefined,
): SetUnitRateCommand | undefined {
  const unitRate = parseUnitRate(text, examPrepScope);

  return unitRate
    ? {
        type: 'set_unit_rate',
        unitRate,
        sourceText: text,
        sourceSegment: unitRate.rawText,
        confidence: unitRate.uncertainty === 'medium' ? 'medium' : 'high',
      }
    : undefined;
}
