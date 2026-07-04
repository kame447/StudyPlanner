import type { SetUnitRateCommand } from './weeklyPlanningCommandTypes';
import type { ExamPrepScope, UnitRateEstimate } from './weeklyPlanningIntakeTypes';
import { normalizeIntakeText, parseSmallInteger, splitIntakeSegments } from './weeklyPlanningTextParsing';

function buildYearFieldUnitRate(
  match: RegExpMatchArray,
  segment: string,
): UnitRateEstimate | undefined {
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
  const segment = normalizeIntakeText(text).trim();
  const match = segment.match(
    /^(?:だいたい\s*)?([0-9]+|[一二三四五六七八九十]+)\s*時間\s*(?:くらい|ぐらい)?\s*(?:です)?$/,
  );

  if (!match) {
    return undefined;
  }

  const hours = parseSmallInteger(match[1]);

  if (!hours) {
    return undefined;
  }

  const uncertainty = /くらい|ぐらい|だいたい/.test(segment) ? 'medium' : 'low';
  const unitRate: UnitRateEstimate = {
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

export function parseUnitRate(
  text: string,
  examPrepScope: ExamPrepScope | undefined,
): UnitRateEstimate | undefined {
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