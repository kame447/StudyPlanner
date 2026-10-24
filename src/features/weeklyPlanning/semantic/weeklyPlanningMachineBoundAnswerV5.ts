/**
 * #735 typed machine-bound effort answer.
 *
 * The user operated a typed control that the application attached to one presented
 * missing-effort question. The value and its measurement come from that control, not
 * from reading the user's words; `displayText` is generated here from the typed value
 * and is never parsed. Free-text replies keep the existing AI-owned route.
 */
export type WeeklyPlanningMachineBoundEffortMeasurementV5 = 'total_duration' | 'duration_per_unit';

export interface WeeklyPlanningMachineBoundEffortAnswerV5 {
  version: 1;
  kind: 'effort_duration';
  /** Assistant message whose question card carried the control. */
  assistantMessageId: string;
  /** Pending question action identity, or null when the question has none. */
  questionActionId: string | null;
  targetFactId: string;
  graphRevision: number;
  effortMeasurement: WeeklyPlanningMachineBoundEffortMeasurementV5;
  minutes: number;
}

/** Closed option sets: the control never accepts an arbitrary typed number. */
export const MACHINE_BOUND_EFFORT_ANSWER_MINUTES_V5: Readonly<Record<
  WeeklyPlanningMachineBoundEffortMeasurementV5, readonly number[]
>> = {
  total_duration: [15, 30, 45, 60, 90, 120, 180],
  duration_per_unit: [1, 2, 3, 5, 10, 15, 30],
};

const ANSWER_KEYS = [
  'version', 'kind', 'assistantMessageId', 'questionActionId',
  'targetFactId', 'graphRevision', 'effortMeasurement', 'minutes',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

/** Strict structural decoder; anything unexpected fails closed to the AI route. */
export function decodeWeeklyPlanningMachineBoundEffortAnswerV5(
  value: unknown,
): WeeklyPlanningMachineBoundEffortAnswerV5 | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== ANSWER_KEYS.length || !ANSWER_KEYS.every(key => keys.includes(key))) return null;
  if (value.version !== 1 || value.kind !== 'effort_duration'
    || !boundedId(value.assistantMessageId)
    || !(value.questionActionId === null || boundedId(value.questionActionId))
    || !boundedId(value.targetFactId)
    || !Number.isSafeInteger(value.graphRevision) || (value.graphRevision as number) < 0
    || (value.effortMeasurement !== 'total_duration' && value.effortMeasurement !== 'duration_per_unit')
    || !MACHINE_BOUND_EFFORT_ANSWER_MINUTES_V5[value.effortMeasurement].includes(value.minutes as number)) {
    return null;
  }
  return {
    version: 1,
    kind: 'effort_duration',
    assistantMessageId: value.assistantMessageId,
    questionActionId: value.questionActionId,
    targetFactId: value.targetFactId,
    graphRevision: value.graphRevision as number,
    effortMeasurement: value.effortMeasurement,
    minutes: value.minutes as number,
  };
}

function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}分`;
  return rest === 0 ? `${hours}時間` : `${hours}時間${rest}分`;
}

/** Deterministic presentation of the typed value. The server compares, never parses, it. */
export function formatWeeklyPlanningMachineBoundEffortAnswerV5(
  answer: Pick<WeeklyPlanningMachineBoundEffortAnswerV5, 'effortMeasurement' | 'minutes'>,
): string {
  const duration = durationLabel(answer.minutes);
  return answer.effortMeasurement === 'total_duration'
    ? `全体で約${duration}`
    : `1つあたり約${duration}`;
}
