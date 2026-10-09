import type { JsonSchemaResponseFormat } from '../../../services/ai/openAiCompatibleClient';
import type { WeeklyPlanningMustConveyEntry } from './weeklyPlanningMustConvey';

/**
 * Verification of an AI-written reply against typed facts (Issue #488 P2). No Japanese parsing:
 *  - V3 (deterministic): digit runs and exact user-label substrings, character classes only;
 *  - V2 (independent verifier call): enumerated verdicts per required code, never the writer's own claim.
 * Anything unclear is a failure, never a pass.
 */

/** Digit runs of a reply, full-width folded and digit-group separators removed ("1,808" and "１８０８" both give "1808"). */
export function replyDigitRuns(text: string): string[] {
  const folded = text
    .replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xff10))
    .replace(/(?<=\d)[,，](?=\d{3}(?!\d))/g, '');
  return folded.match(/\d+(?:\.\d+)?/g) ?? [];
}

/**
 * Minutes expressed as hours (+ minutes) in the reply: a closed number-and-unit token set ("4時間", "1時間30分", "1.5時間"),
 * not sentence parsing. 240 = "4時間" = "240分"; 90 = "1時間30分".
 */
export function replyDurationMinutes(text: string): Set<number> {
  const folded = text
    .replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xff10))
    .replace(/(?<=\d)[,，](?=\d{3}(?!\d))/g, '');
  const minutes = new Set<number>();
  for (const match of folded.matchAll(/(\d+(?:\.\d+)?)\s*時間(?:\s*(\d+)\s*分|半)?/g)) {
    const extra = match[2] ? Number(match[2]) : match[0].endsWith('半') ? 30 : 0;
    minutes.add(Math.round(Number(match[1]) * 60 + extra));
  }
  return minutes;
}

export interface WeeklyPlanningLiteralFailure {
  code: WeeklyPlanningMustConveyEntry['code'];
  missingNumbers: number[];
  missingLabels: string[];
}

/** V3: every required number is a digit run of the reply and every required user label occurs literally. */
export function literalRequirementFailures(
  text: string,
  entries: readonly WeeklyPlanningMustConveyEntry[],
): WeeklyPlanningLiteralFailure[] {
  const runs = new Set(replyDigitRuns(text));
  const durations = replyDurationMinutes(text);
  const failures: WeeklyPlanningLiteralFailure[] = [];
  for (const entry of entries) {
    const numbers = [entry.requiredMinutes, ...entry.unmet.map((item) => item.minutes)];
    const missingNumbers = [...new Set(numbers.filter((value) => !runs.has(String(Math.round(value))) && !durations.has(Math.round(value))))];
    const missingLabels = [...new Set(entry.unmet.map((item) => item.label).filter((label) => label && !text.includes(label)))];
    if (missingNumbers.length > 0 || missingLabels.length > 0) failures.push({ code: entry.code, missingNumbers, missingLabels });
  }
  return failures;
}

export const WEEKLY_PLANNING_REPLY_VERIFIER_RESPONSE_FORMAT: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_reply_verifier_v1',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['verdicts', 'forbidden'],
      properties: {
        verdicts: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['code', 'verdict'],
            properties: {
              code: { type: 'string', enum: ['shortfall'] },
              verdict: { type: 'string', enum: ['stated_accurately', 'missing', 'contradicted'] },
            },
          },
        },
        forbidden: {
          type: 'array',
          items: { type: 'string', enum: ['plan_fits', 'plan_complete', 'saved'] },
        },
      },
    },
  },
};

export function createReplyVerifierMessages(params: {
  entries: readonly WeeklyPlanningMustConveyEntry[];
  text: string;
}): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content: [
        'You verify one assistant reply against typed facts. Judge only the reply and the facts given.',
        'Code "shortfall": the weekly plan needs requiredMinutes minutes in total, NOT all of the work fits in the available time, and "unmet" lists the work (label and minutes) that could not be placed (moreCount further items are not listed).',
        'For each required code return stated_accurately only if the reply conveys the fact with the given numbers and labels and does not contradict it; missing if it does not convey it; contradicted if it says otherwise (for example that everything fits or was scheduled).',
        'In "forbidden" list each of these claims the reply makes, and nothing else: plan_fits (says all the work fits, was scheduled or was placed, or that nothing is left over); plan_complete (calls the plan finished or complete); saved (says the plan was saved, registered or added to the calendar).',
        'Saying that the user\'s message or a change was taken into account is NOT a forbidden claim.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify({
        required: params.entries.map((entry) => ({ code: entry.code, requiredMinutes: entry.requiredMinutes, unmet: entry.unmet, moreCount: entry.moreCount })),
        reply: params.text,
      }),
    },
  ];
}

export type WeeklyPlanningReplyVerdict =
  | { ok: true }
  | { ok: false; reason: 'verdict'; failedCodes: string[]; forbidden: string[] }
  | { ok: false; reason: 'malformed' };

/** The verdict list must cover EXACTLY the required codes; every one stated_accurately and nothing forbidden. */
export function evaluateReplyVerifierResponse(
  raw: string,
  entries: readonly WeeklyPlanningMustConveyEntry[],
): WeeklyPlanningReplyVerdict {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'malformed' };
    const record = value as { verdicts?: unknown; forbidden?: unknown };
    if (!Array.isArray(record.verdicts) || !Array.isArray(record.forbidden)) return { ok: false, reason: 'malformed' };
    const required = entries.map((entry) => entry.code).sort();
    const answered = record.verdicts.map((item) => (item as { code?: unknown })?.code);
    if (answered.length !== required.length || [...answered].sort().some((code, index) => code !== required[index])) return { ok: false, reason: 'malformed' };
    const failedCodes = record.verdicts
      .filter((item) => (item as { verdict?: unknown }).verdict !== 'stated_accurately')
      .map((item) => String((item as { code?: unknown }).code));
    const forbidden = record.forbidden.map(String);
    return failedCodes.length === 0 && forbidden.length === 0 ? { ok: true } : { ok: false, reason: 'verdict', failedCodes, forbidden };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}
