import type { JsonSchemaResponseFormat } from '../../../services/ai/openAiCompatibleClient';
import { mustConveyKey, type WeeklyPlanningMustConveyEntry } from './weeklyPlanningMustConvey';

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

/**
 * One handler per mustConvey code (the compiler requires a handler for every code of the union, so a new code is added
 * HERE without touching another code's logic): its V3 check, the fact shown to the verifier, its definition for the
 * verifier's system prompt, and the forbidden claims that are false whenever the fact holds.
 */
interface ReplyLiterals {
  text: string;
  runs: ReadonlySet<string>;
  durations: ReadonlySet<number>;
}

interface MustConveyHandler<E extends WeeklyPlanningMustConveyEntry> {
  literalFailure(entry: E, reply: ReplyLiterals): { missingNumbers: number[]; missingLabels: string[] };
  verifierFact(entry: E): Record<string, unknown>;
  definition: string;
  forbidden: readonly WeeklyPlanningForbiddenClaim[];
}

export type WeeklyPlanningForbiddenClaim = 'plan_fits' | 'plan_complete' | 'saved' | 'preview_offered';

const hasMinutes = (reply: ReplyLiterals, minutes: number): boolean =>
  reply.runs.has(String(Math.round(minutes))) || reply.durations.has(Math.round(minutes));

const HANDLERS: { [C in WeeklyPlanningMustConveyEntry['code']]: MustConveyHandler<Extract<WeeklyPlanningMustConveyEntry, { code: C }>> } = {
  shortfall: {
    // The total, each unmet item's minutes, and (when there are more) how many more: all must be digit runs of the reply.
    literalFailure: (entry, reply) => {
      const numbers = [entry.requiredMinutes, ...entry.unmet.map((item) => item.minutes)];
      const missingNumbers = numbers.filter((value) => !hasMinutes(reply, value));
      if (entry.moreCount > 0 && !reply.runs.has(String(entry.moreCount))) missingNumbers.push(entry.moreCount);
      return { missingNumbers, missingLabels: entry.unmet.map((item) => item.label).filter((label) => label && !reply.text.includes(label)) };
    },
    verifierFact: (entry) => ({ key: mustConveyKey(entry), code: entry.code, planTotalMinutes: entry.requiredMinutes, unmetItems: entry.unmet, furtherUnmetItemCount: entry.moreCount }),
    definition: [
      'Code "shortfall": planTotalMinutes is the minutes the WHOLE plan needs; NOT all of the work fits in the available time; unmetItems lists each work item that could NOT be placed, with its own minutes; furtherUnmetItemCount is how many MORE items did not fit and are not listed.',
      'planTotalMinutes is NOT the amount that did not fit: a reply that presents it as the unmet amount, or attaches any figure to the wrong thing, is contradicted.',
      'stated_accurately requires all of: the reply says not everything fits; it names every unmet item with its own minutes; it gives the plan total as what the whole plan needs; and, when furtherUnmetItemCount is above zero, it says that further items also did not fit (missing if it does not).',
      'When the unmet work IS the whole plan (a single unmet item whose minutes equal planTotalMinutes, or every item is unmet), stating the plan total once, naming the work, and saying that it does not fit is accurate: the item\'s own minutes need not be repeated separately, and a total that equals the one unmet item is not a confusion of the two.',
      'contradicted if it says otherwise, for example that everything fits or was scheduled.',
    ].join(' '),
    forbidden: ['plan_fits', 'plan_complete', 'saved'],
  },
  declared_amount_waiting: {
    // The user's own words OR the amount (in the declared unit, or as the equivalent hours/minutes) must appear.
    literalFailure: (entry, reply) => {
      const minutes = entry.unitCode === 'hour' ? entry.amount * 60 : entry.amount;
      const stated = (entry.quote !== '' && reply.text.includes(entry.quote)) || hasMinutes(reply, minutes)
        || reply.runs.has(String(Math.round(entry.amount)));
      return { missingNumbers: stated ? [] : [entry.amount], missingLabels: [] };
    },
    verifierFact: (entry) => ({ key: mustConveyKey(entry), code: entry.code, statedAmount: entry.amount, unit: entry.unitCode, userQuote: entry.quote }),
    definition: [
      'Code "declared_amount_waiting": the user stated an amount (statedAmount in unit; userQuote is their own words) whose role is not yet known. It is NOT used in the plan yet and waits for the user to say whether it is an amount still to do or an amount already done.',
      'stated_accurately requires the reply to convey that this amount is not used yet and waits for that choice; missing if it does not; contradicted if it says the amount was applied, counted or planned with, or that a plan was made using it.',
    ].join(' '),
    forbidden: ['plan_complete', 'saved', 'preview_offered'],
  },
};

const ALL_FORBIDDEN_CLAIMS: readonly WeeklyPlanningForbiddenClaim[] = ['plan_fits', 'plan_complete', 'saved', 'preview_offered'];
const FORBIDDEN_CLAIM_DEFINITIONS: Record<WeeklyPlanningForbiddenClaim, string> = {
  plan_fits: 'plan_fits (says all the work fits, was scheduled or was placed, or that nothing is left over)',
  plan_complete: 'plan_complete (calls the plan finished or complete)',
  saved: 'saved (says the plan was saved, registered or added to the calendar)',
  preview_offered: 'preview_offered (says a candidate schedule or preview is ready, or invites the user to look at or adopt one)',
};

function handlerOf<E extends WeeklyPlanningMustConveyEntry>(entry: E): MustConveyHandler<E> {
  return HANDLERS[entry.code] as unknown as MustConveyHandler<E>;
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
    const found = handlerOf(entry).literalFailure(entry, { text, runs, durations });
    const missingNumbers = [...new Set(found.missingNumbers)];
    const missingLabels = [...new Set(found.missingLabels)];
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
            required: ['key', 'verdict'],
            properties: {
              key: { type: 'string' },
              verdict: { type: 'string', enum: ['stated_accurately', 'missing', 'contradicted'] },
            },
          },
        },
        forbidden: {
          type: 'array',
          items: { type: 'string', enum: [...ALL_FORBIDDEN_CLAIMS] },
        },
      },
    },
  },
};

export function createReplyVerifierMessages(params: {
  entries: readonly WeeklyPlanningMustConveyEntry[];
  text: string;
}): Array<{ role: 'system' | 'user'; content: string }> {
  const forbidden = [...new Set(params.entries.flatMap((entry) => handlerOf(entry).forbidden))];
  return [
    {
      role: 'system',
      content: [
        'You verify one assistant reply against typed facts. Judge only the reply and the facts given.',
        ...[...new Set(params.entries.map((entry) => entry.code))].map((code) => HANDLERS[code].definition),
        'Return one verdict per required entry, with the entry\'s "key" exactly as given. For each entry return stated_accurately only if the reply conveys the fact accurately, missing if it does not convey it, contradicted if it says otherwise.',
        `In "forbidden" list each of these claims the reply makes, and nothing else: ${forbidden.map((claim) => FORBIDDEN_CLAIM_DEFINITIONS[claim]).join('; ')}.`,
        'Saying that the user\'s message or a change was taken into account is NOT a forbidden claim.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify({ required: params.entries.map((entry) => handlerOf(entry).verifierFact(entry)), reply: params.text }),
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
    const required = entries.map(mustConveyKey).sort();
    const answered = record.verdicts.map((item) => (item as { key?: unknown })?.key);
    if (answered.length !== required.length || [...answered].sort().some((code, index) => code !== required[index])) return { ok: false, reason: 'malformed' };
    const failedCodes = record.verdicts
      .filter((item) => (item as { verdict?: unknown }).verdict !== 'stated_accurately')
      .map((item) => String((item as { key?: unknown }).key));
    const forbidden = record.forbidden.map(String);
    return failedCodes.length === 0 && forbidden.length === 0 ? { ok: true } : { ok: false, reason: 'verdict', failedCodes, forbidden };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}
