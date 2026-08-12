import type {
  ChatMessage,
  JsonSchemaResponseFormat,
} from '../../../services/ai/openAiCompatibleClient';
import type {
  SemanticPlanningWindowV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

export const FOCUSED_PLANNING_WINDOW_REPAIR_MAX_COMPLETION_TOKENS = 120;

const ISO_DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

export const FOCUSED_PLANNING_WINDOW_REPAIR_RESPONSE_FORMAT_V5: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_focused_planning_window_repair_v5',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['value', 'start', 'end'],
      properties: {
        value: { type: 'string' },
        start: { type: 'string', pattern: ISO_DATE_PATTERN },
        end: { type: 'string', pattern: ISO_DATE_PATTERN },
      },
    },
  },
};

const ABSOLUTE_WINDOW_REPRESENTATION_ERRORS = [
  /^document\.planningWindow:absolute-range$/,
  /^document\.planningWindow:absolute-iso-range-required$/,
  /^document\.planningWindow:absolute-range-order$/,
  /^document\.planningWindow\.value:absolute-canonical-range:/,
] as const;

export interface FocusedPlanningWindowRepairInputV5 {
  userText: string;
  invalidDocument: WeeklyPlanningSemanticDocumentV5;
  validationErrors: readonly string[];
  calendarContext?: {
    currentDate?: string | null;
    timeZone?: string | null;
  } | null;
}

export interface FocusedPlanningWindowRepairDecisionV5 {
  value: string;
  start: string;
  end: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function focusedPlanningWindowRepairEligibleV5(
  input: FocusedPlanningWindowRepairInputV5,
): boolean {
  return input.invalidDocument.planningWindow?.kind === 'absolute'
    && input.validationErrors.length > 0
    && input.validationErrors.every((error) =>
      ABSOLUTE_WINDOW_REPRESENTATION_ERRORS.some((pattern) => pattern.test(error)));
}

function compactCalendarContext(
  context: FocusedPlanningWindowRepairInputV5['calendarContext'],
): Record<string, string> | null {
  if (!context) return null;
  const compact: Record<string, string> = {};
  if (typeof context.currentDate === 'string' && context.currentDate) {
    compact.currentDate = context.currentDate;
  }
  if (typeof context.timeZone === 'string' && context.timeZone) {
    compact.timeZone = context.timeZone;
  }
  return Object.keys(compact).length > 0 ? compact : null;
}

export function createFocusedPlanningWindowRepairMessagesV5(
  input: FocusedPlanningWindowRepairInputV5,
): ChatMessage[] {
  const window = input.invalidDocument.planningWindow;
  if (!window || window.kind !== 'absolute') {
    throw new Error('Focused planning-window repair requires an absolute planning window.');
  }

  return [
    {
      role: 'system',
      content: [
        'Repair only the canonical representation of one already-interpreted absolute planning window.',
        'Preserve its existing scope and source meaning. Do not reinterpret tasks, availability, relations, intent, or any other planning fact.',
        'Return only value/start/end. start and end must be YYYY-MM-DD, start must not be after end, and value must be exactly <start>/<end>.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        currentUserText: input.userText,
        sourceText: window.sourceText,
        invalidRepresentation: {
          value: window.value,
          start: window.start,
          end: window.end,
        },
        calendarContext: compactCalendarContext(input.calendarContext),
      }),
    },
  ];
}

export function parseFocusedPlanningWindowRepairDecisionV5(
  raw: string,
): FocusedPlanningWindowRepairDecisionV5 | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value)) return null;
    if (
      typeof value.value !== 'string'
      || typeof value.start !== 'string'
      || typeof value.end !== 'string'
    ) {
      return null;
    }
    return {
      value: value.value,
      start: value.start,
      end: value.end,
    };
  } catch {
    return null;
  }
}

export function applyFocusedPlanningWindowRepairV5(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  decision: FocusedPlanningWindowRepairDecisionV5;
}): WeeklyPlanningSemanticDocumentV5 {
  const window = params.document.planningWindow;
  if (!window || window.kind !== 'absolute') {
    throw new Error('Cannot apply focused planning-window repair to a non-absolute window.');
  }

  const repairedWindow: SemanticPlanningWindowV5 = {
    ...window,
    value: params.decision.value,
    start: params.decision.start,
    end: params.decision.end,
  };

  return {
    ...params.document,
    planningWindow: repairedWindow,
  };
}
