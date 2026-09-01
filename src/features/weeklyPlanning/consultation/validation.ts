import {
  LEARNING_CONSULTATION_ANSWER_VERSION,
  LEARNING_CONSULTATION_TURN_PURPOSE_VERSION,
  type AdviceAnswerDocument,
  type AdviceUncertainty,
  type TemporalCandidate,
  type TurnPurposeDocument,
  type TurnPurposeKind,
} from './contracts';

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: readonly string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
    && allowed.every((key) => key in value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isUncertainty(value: unknown): value is AdviceUncertainty {
  return value === 'low' || value === 'medium' || value === 'high';
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function isTemporalCandidate(value: unknown): value is TemporalCandidate {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;

  switch (value.kind) {
    case 'absolute_date':
      return hasExactKeys(value, ['kind', 'date']) && isIsoDate(value.date);
    case 'month_end':
      return hasExactKeys(value, ['kind', 'year', 'month'])
        && isInteger(value.year)
        && isInteger(value.month)
        && value.month >= 1
        && value.month <= 12;
    case 'relative_to_exam':
      return hasExactKeys(value, ['kind', 'examRef', 'offsetDays'])
        && isNonEmptyString(value.examRef)
        && isInteger(value.offsetDays);
    case 'date_range':
      return hasExactKeys(value, ['kind', 'startDate', 'endDate'])
        && isIsoDate(value.startDate)
        && isIsoDate(value.endDate)
        && value.startDate <= value.endDate;
    default:
      return false;
  }
}

const TURN_PURPOSE_KINDS: readonly TurnPurposeKind[] = [
  'planning_operation',
  'learning_consultation',
  'consultation_review',
  'consultation_followup',
  'unresolved',
];

export function validateTurnPurposeDocument(input: unknown): ValidationResult<TurnPurposeDocument> {
  if (!isRecord(input)) return { ok: false, errors: ['turn purpose must be an object'] };
  if (!hasExactKeys(input, ['schemaVersion', 'kind'])) {
    return { ok: false, errors: ['turn purpose contains missing or unexpected fields'] };
  }
  if (input.schemaVersion !== LEARNING_CONSULTATION_TURN_PURPOSE_VERSION) {
    return { ok: false, errors: ['unsupported turn purpose version'] };
  }
  if (!TURN_PURPOSE_KINDS.includes(input.kind as TurnPurposeKind)) {
    return { ok: false, errors: ['invalid turn purpose kind'] };
  }
  return { ok: true, value: input as unknown as TurnPurposeDocument };
}

function validateMaterialMention(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (!hasOnlyKeys(value, ['name', 'editionHint', 'isbnHint', 'whyRelevant'])) {
    errors.push(`${path} contains an unexpected authority field`);
  }
  if (!isNonEmptyString(value.name)) errors.push(`${path}.name is required`);
  if (!isNonEmptyString(value.whyRelevant)) errors.push(`${path}.whyRelevant is required`);
  if (value.editionHint !== undefined && typeof value.editionHint !== 'string') {
    errors.push(`${path}.editionHint must be a string`);
  }
  if (value.isbnHint !== undefined && typeof value.isbnHint !== 'string') {
    errors.push(`${path}.isbnHint must be a string`);
  }
}

function validateRecommendation(
  value: unknown,
  path: string,
  errors: string[],
  allowedEvidenceRefs: ReadonlySet<string> | null,
  allowedAssumptionRefs: ReadonlySet<string> | null,
): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }

  const allowed = [
    'recommendationKind',
    'materialMention',
    'method',
    'sequencePosition',
    'milestone',
    'temporalTarget',
    'rationale',
    'assumptionRefs',
    'evidenceRefs',
    'uncertainty',
  ];
  if (!hasOnlyKeys(value, allowed)) errors.push(`${path} contains an unexpected field`);
  if (!isNonEmptyString(value.recommendationKind)) errors.push(`${path}.recommendationKind is required`);
  if (!isNonEmptyString(value.rationale)) errors.push(`${path}.rationale is required`);
  if (!isStringArray(value.assumptionRefs)) errors.push(`${path}.assumptionRefs must be a string array`);
  if (!isStringArray(value.evidenceRefs)) errors.push(`${path}.evidenceRefs must be a string array`);
  if (!isUncertainty(value.uncertainty)) errors.push(`${path}.uncertainty is invalid`);

  if (value.materialMention !== undefined) validateMaterialMention(value.materialMention, `${path}.materialMention`, errors);
  if (value.method !== undefined && typeof value.method !== 'string') errors.push(`${path}.method must be a string`);
  if (value.sequencePosition !== undefined && (!isInteger(value.sequencePosition) || value.sequencePosition < 1)) {
    errors.push(`${path}.sequencePosition must be a positive integer`);
  }
  if (value.milestone !== undefined && typeof value.milestone !== 'string') errors.push(`${path}.milestone must be a string`);
  if (value.temporalTarget !== undefined && !isTemporalCandidate(value.temporalTarget)) {
    errors.push(`${path}.temporalTarget is invalid`);
  }

  if (allowedEvidenceRefs && isStringArray(value.evidenceRefs)) {
    for (const reference of value.evidenceRefs) {
      if (!allowedEvidenceRefs.has(reference)) errors.push(`${path}.evidenceRefs contains unknown ref ${reference}`);
    }
  }
  if (allowedAssumptionRefs && isStringArray(value.assumptionRefs)) {
    for (const reference of value.assumptionRefs) {
      if (!allowedAssumptionRefs.has(reference)) errors.push(`${path}.assumptionRefs contains unknown ref ${reference}`);
    }
  }
}

export interface AdviceAnswerValidationContext {
  allowedEvidenceRefs?: readonly string[];
  allowedAssumptionRefs?: readonly string[];
}

export function validateAdviceAnswerDocument(
  input: unknown,
  context: AdviceAnswerValidationContext = {},
): ValidationResult<AdviceAnswerDocument> {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ['answer must be an object'] };
  if (input.schemaVersion !== LEARNING_CONSULTATION_ANSWER_VERSION) {
    errors.push('unsupported answer version');
  }

  const evidenceRefs = context.allowedEvidenceRefs ? new Set(context.allowedEvidenceRefs) : null;
  const assumptionRefs = context.allowedAssumptionRefs ? new Set(context.allowedAssumptionRefs) : null;

  if (input.kind === 'proposal') {
    if (!hasExactKeys(input, ['schemaVersion', 'kind', 'userFacingAnswer', 'options', 'assumptions', 'overallUncertainty'])) {
      errors.push('proposal contains missing or unexpected fields');
    }
    if (!isNonEmptyString(input.userFacingAnswer)) errors.push('proposal.userFacingAnswer is required');
    if (!isStringArray(input.assumptions)) errors.push('proposal.assumptions must be a string array');
    if (!isUncertainty(input.overallUncertainty)) errors.push('proposal.overallUncertainty is invalid');
    if (!Array.isArray(input.options) || input.options.length === 0) {
      errors.push('proposal.options must contain at least one option');
    } else {
      input.options.forEach((option, optionIndex) => {
        const path = `proposal.options[${optionIndex}]`;
        if (!isRecord(option)) {
          errors.push(`${path} must be an object`);
          return;
        }
        if (!hasExactKeys(option, ['title', 'strategySummary', 'recommendations', 'tradeoffs'])) {
          errors.push(`${path} contains missing or unexpected fields`);
        }
        if (!isNonEmptyString(option.title)) errors.push(`${path}.title is required`);
        if (!isNonEmptyString(option.strategySummary)) errors.push(`${path}.strategySummary is required`);
        if (!isStringArray(option.tradeoffs)) errors.push(`${path}.tradeoffs must be a string array`);
        if (!Array.isArray(option.recommendations) || option.recommendations.length === 0) {
          errors.push(`${path}.recommendations must contain at least one recommendation`);
        } else {
          option.recommendations.forEach((recommendation, recommendationIndex) => {
            validateRecommendation(
              recommendation,
              `${path}.recommendations[${recommendationIndex}]`,
              errors,
              evidenceRefs,
              assumptionRefs,
            );
          });
        }
      });
    }
  } else if (input.kind === 'clarification') {
    if (!hasExactKeys(input, ['schemaVersion', 'kind', 'userFacingAnswer', 'requestedMeaning', 'whyItMatters', 'allowedUnknown'])) {
      errors.push('clarification contains missing or unexpected fields');
    }
    if (!isNonEmptyString(input.userFacingAnswer)) errors.push('clarification.userFacingAnswer is required');
    if (!isNonEmptyString(input.requestedMeaning)) errors.push('clarification.requestedMeaning is required');
    if (!isNonEmptyString(input.whyItMatters)) errors.push('clarification.whyItMatters is required');
    if (input.allowedUnknown !== true) errors.push('clarification.allowedUnknown must be true');
  } else if (input.kind === 'explanation') {
    if (!hasExactKeys(input, ['schemaVersion', 'kind', 'userFacingAnswer', 'rationale', 'assumptionRefs', 'evidenceRefs', 'tradeoffs', 'historical'])) {
      errors.push('explanation contains missing or unexpected fields');
    }
    if (!isNonEmptyString(input.userFacingAnswer)) errors.push('explanation.userFacingAnswer is required');
    if (!isNonEmptyString(input.rationale)) errors.push('explanation.rationale is required');
    if (!isStringArray(input.assumptionRefs)) errors.push('explanation.assumptionRefs must be a string array');
    if (!isStringArray(input.evidenceRefs)) errors.push('explanation.evidenceRefs must be a string array');
    if (!isStringArray(input.tradeoffs)) errors.push('explanation.tradeoffs must be a string array');
    if (typeof input.historical !== 'boolean') errors.push('explanation.historical must be boolean');
  } else {
    errors.push('answer kind must be exactly proposal, clarification, or explanation');
  }

  return errors.length === 0
    ? { ok: true, value: input as unknown as AdviceAnswerDocument }
    : { ok: false, errors };
}
