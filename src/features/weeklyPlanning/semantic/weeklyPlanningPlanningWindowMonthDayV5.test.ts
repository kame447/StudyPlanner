import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  isCanonicalMonthDayExpression,
  resolveCanonicalDateExpression,
  resolveCanonicalMonthDayOnOrAfter,
} from './weeklyPlanningCalendarResolver';
import { normalizePlanningWindowCanonicalRawV5 } from './weeklyPlanningPlanningWindowCanonicalContractV5';
import { createWeeklyPlanningSemanticBaseMessagesV5 } from './weeklyPlanningSemanticPromptAssemblyV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';

/*
 * Issue #152 O1: retention case single-day-plan (「8月25日だけの計画を作りたいです。…」).
 * The user states no year. Before this contract the provider schema forced a full
 * YYYY-MM-DD, so the model had to pick a year itself (Real runs committed 8190, or
 * failed the single repair). The model now writes the year-less month-day as
 * ISO 8601 --MM-DD and deterministic calendar arithmetic resolves the year against
 * the captured calendarContext.currentDate.
 */

const USER_TEXT = '8月25日だけの計画を作りたいです。数学を20問進めたいです。';

function singleDayResponse(params: {
  start: string;
  end?: string;
  value?: string;
  sourceText?: string;
}): string {
  const end = params.end ?? params.start;
  return JSON.stringify({
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'planning-window-1',
      kind: 'absolute',
      value: params.value ?? `${params.start}/${end}`,
      start: params.start,
      end,
      sourceText: params.sourceText ?? '8月25日だけの計画',
    },
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  });
}

function summary(currentDate: string | null): Record<string, unknown> {
  return currentDate
    ? { calendarContext: { currentDate, timeZone: 'Asia/Tokyo' } }
    : {};
}

function scriptedClient(responses: string[]) {
  const calls: Parameters<OpenAiCompatibleClient['createChatCompletion']>[0][] = [];
  const client: OpenAiCompatibleClient = {
    async createChatCompletion(request) {
      calls.push(request);
      const response = responses.shift();
      if (!response) throw new Error('response sequence exhausted');
      return response;
    },
  };
  return { client, calls };
}

describe('canonical month-day (--MM-DD) calendar resolution', () => {
  it('resolves to the next occurrence on or after the reference date', () => {
    expect(resolveCanonicalMonthDayOnOrAfter('--08-25', '2026-08-17')).toBe('2026-08-25');
    expect(resolveCanonicalMonthDayOnOrAfter('--08-25', '2026-08-25')).toBe('2026-08-25');
    expect(resolveCanonicalMonthDayOnOrAfter('--08-25', '2026-09-26')).toBe('2027-08-25');
    expect(resolveCanonicalMonthDayOnOrAfter('--02-29', '2026-08-17')).toBe('2028-02-29');
  });

  it('rejects impossible month-days, non-canonical shapes, and invalid references', () => {
    expect(resolveCanonicalMonthDayOnOrAfter('--02-30', '2026-08-17')).toBeNull();
    expect(resolveCanonicalMonthDayOnOrAfter('--13-01', '2026-08-17')).toBeNull();
    expect(resolveCanonicalMonthDayOnOrAfter('08-25', '2026-08-17')).toBeNull();
    expect(resolveCanonicalMonthDayOnOrAfter('8月25日', '2026-08-17')).toBeNull();
    expect(resolveCanonicalMonthDayOnOrAfter('--08-25', 'not-a-date')).toBeNull();
    expect(isCanonicalMonthDayExpression('--08-25')).toBe(true);
    expect(isCanonicalMonthDayExpression('2026-08-25')).toBe(false);
  });

  it('keeps the shared dateExpression vocabulary unchanged', () => {
    expect(resolveCanonicalDateExpression({
      expression: '--08-25',
      currentDate: '2026-08-17',
    }).status).toBe('unsupported_expression');
  });
});

describe('Issue 152 O1 single-day-plan planning-window year', () => {
  it('tells the model to leave a year-less window date to calendar resolution', () => {
    const [system, user] = createWeeklyPlanningSemanticBaseMessagesV5({
      userText: USER_TEXT,
      publicStateSummary: summary('2026-08-17'),
    });
    expect(system.content).toContain('write start/end as --MM-DD');
    expect(JSON.parse(user.content).publicStateSummary.calendarContext.currentDate)
      .toBe('2026-08-17');
  });

  it('commits the exact retention case as 2026-08-25 from a year-less --08-25 response', async () => {
    const { client, calls } = scriptedClient([
      singleDayResponse({ start: '--08-25', value: '8月25日' }),
    ]);
    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: USER_TEXT,
      publicStateSummary: summary('2026-08-17'),
    });
    expect(result.status).toBe('accepted');
    expect(result.document?.planningWindow).toMatchObject({
      kind: 'absolute',
      start: '2026-08-25',
      end: '2026-08-25',
      value: '2026-08-25/2026-08-25',
      sourceText: '8月25日だけの計画',
    });
    expect(result.diagnostics).toMatchObject({ attemptCount: 1, repairAttempted: false });
    expect(calls).toHaveLength(1);
  });

  it('resolves the same month-day to next year once the reference date has passed it', () => {
    const validation = validateWeeklyPlanningSemanticResponseV5(
      singleDayResponse({ start: '--08-25' }),
      { currentUserText: USER_TEXT, publicStateSummary: summary('2026-09-26') },
    );
    expect(validation.errors).toEqual([]);
    expect(validation.document?.planningWindow?.start).toBe('2027-08-25');
    expect(validation.algorithmicRepairs).toContain(
      'planning-window-month-day-resolved:start:2027-08-25',
    );
  });

  it('repairs the observed 8190 response once via the month-day form', async () => {
    const { client, calls } = scriptedClient([
      singleDayResponse({ start: '8190-08-25' }),
      singleDayResponse({ start: '--08-25' }),
    ]);
    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: USER_TEXT,
      publicStateSummary: summary('2026-08-17'),
    });
    expect(result.status).toBe('accepted');
    expect(result.document?.planningWindow?.start).toBe('2026-08-25');
    expect(result.diagnostics).toMatchObject({ attemptCount: 2, repairAttempted: true });
    const repairMessage = calls[1].messages[calls[1].messages.length - 1]?.content ?? '';
    expect(repairMessage).toContain('absolute-year-outside-reference-horizon');
    expect(repairMessage).toContain('Keep the same planningWindow localId');
    expect(repairMessage).toContain('--MM-DD');
    expect(repairMessage).not.toContain('do not invent a date');
  });

  it('still fails closed when a repair drops the window but cites its localId', async () => {
    // Replays the shape consistent with the post-2eab80d0 Real rejections
    // (invalid_reference/schema_validation): the old directive read as "no year is
    // supported", so the repair removed the window and pointed an uncertainty at it.
    const repaired = JSON.parse(singleDayResponse({ start: '2026-08-25' }));
    repaired.planningWindow = null;
    repaired.uncertainties = [{
      localId: 'uncertainty-1',
      targetLocalId: 'planning-window-1',
      field: 'planningWindow',
      reason: 'year_not_stated',
      sourceText: '8月25日',
    }];
    const { client } = scriptedClient([
      singleDayResponse({ start: '8190-08-25' }),
      JSON.stringify(repaired),
    ]);
    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: USER_TEXT,
      publicStateSummary: summary('2026-08-17'),
    });
    expect(result.status).toBe('rejected');
    expect(result.document).toBeNull();
    expect(result.diagnostics.validationErrors).toEqual([
      'initial:document.planningWindow:absolute-year-outside-reference-horizon',
      'repair:document.uncertainties[0].targetLocalId',
    ]);
  });

  it('keeps the ten-year bound for explicit years', () => {
    const validation = validateWeeklyPlanningSemanticResponseV5(
      singleDayResponse({ start: '8190-08-25' }),
      { currentUserText: USER_TEXT, publicStateSummary: summary('2026-08-17') },
    );
    expect(validation.document).toBeNull();
    expect(validation.errors).toContain(
      'document.planningWindow:absolute-year-outside-reference-horizon',
    );
  });

  it('fails closed for a month-day without a captured calendar date', () => {
    const validation = validateWeeklyPlanningSemanticResponseV5(
      singleDayResponse({ start: '--08-25' }),
      { currentUserText: USER_TEXT, publicStateSummary: summary(null) },
    );
    expect(validation.document).toBeNull();
    expect(validation.errors).toContain('document.planningWindow:absolute-iso-range-required');
  });

  it('fails closed for an impossible month-day instead of choosing a date', () => {
    const validation = validateWeeklyPlanningSemanticResponseV5(
      singleDayResponse({ start: '--02-30', sourceText: '2月30日だけの計画' }),
      { currentUserText: '2月30日だけの計画を作りたいです。', publicStateSummary: summary('2026-08-17') },
    );
    expect(validation.document).toBeNull();
    expect(validation.errors).toContain('document.planningWindow:absolute-iso-range-required');
  });
});

describe('Issue 152 O1 benign controls', () => {
  it('keeps an explicitly stated 2027 date unchanged', () => {
    const validation = validateWeeklyPlanningSemanticResponseV5(
      singleDayResponse({ start: '2027-08-25', sourceText: '2027年8月25日だけの計画' }),
      {
        currentUserText: '2027年8月25日だけの計画を作りたいです。',
        publicStateSummary: summary('2026-08-17'),
      },
    );
    expect(validation.errors).toEqual([]);
    expect(validation.document?.planningWindow?.start).toBe('2027-08-25');
    expect(validation.algorithmicRepairs.some((repair) => repair.includes('month-day'))).toBe(false);
  });

  it('keeps a next-year exam window stated with its year', () => {
    const validation = validateWeeklyPlanningSemanticResponseV5(
      singleDayResponse({
        start: '2026-08-17',
        end: '2027-02-10',
        sourceText: '来年2月10日の試験までの計画',
      }),
      {
        currentUserText: '来年2月10日の試験までの計画を作りたいです。',
        publicStateSummary: summary('2026-08-17'),
      },
    );
    expect(validation.errors).toEqual([]);
    expect(validation.document?.planningWindow).toMatchObject({
      start: '2026-08-17',
      end: '2027-02-10',
      value: '2026-08-17/2027-02-10',
    });
  });

  it('resolves a year-crossing month-day range with the end on or after the start', () => {
    const validation = validateWeeklyPlanningSemanticResponseV5(
      singleDayResponse({ start: '--12-28', end: '--01-03', sourceText: '12月28日から1月3日' }),
      {
        currentUserText: '12月28日から1月3日の計画を作りたいです。',
        publicStateSummary: summary('2026-08-17'),
      },
    );
    expect(validation.errors).toEqual([]);
    expect(validation.document?.planningWindow).toMatchObject({
      start: '2026-12-28',
      end: '2027-01-03',
      value: '2026-12-28/2027-01-03',
    });
  });

  it('leaves relative planning windows symbolic', () => {
    for (const [kind, value, sourceText, userText] of [
      ['relative_day', 'tomorrow', '明日', '明日の計画を作りたいです。'],
      ['relative_week', 'next_week', '来週', '来週の計画を作りたいです。'],
    ] as const) {
      const raw = JSON.parse(singleDayResponse({ start: '2026-08-25' }));
      raw.planningWindow = {
        localId: 'planning-window-1', kind, value, start: null, end: null, sourceText,
      };
      const validation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(raw), {
        currentUserText: userText,
        publicStateSummary: summary('2026-08-17'),
      });
      expect(validation.errors).toEqual([]);
      expect(validation.document?.planningWindow).toMatchObject({
        kind, value, start: null, end: null,
      });
    }
  });

  it('does not touch a non-absolute window that carries a month-day', () => {
    const raw = JSON.parse(singleDayResponse({ start: '2026-08-25' }));
    raw.planningWindow = {
      localId: 'planning-window-1',
      kind: 'named_period',
      value: 'summer_break',
      start: '--08-25',
      end: '--08-25',
      sourceText: '夏休み',
    };
    const normalized = normalizePlanningWindowCanonicalRawV5(JSON.stringify(raw), '2026-08-17');
    expect(normalized.repairs).toEqual([]);
    expect(JSON.parse(normalized.rawResponse).planningWindow.start).toBe('--08-25');
  });
});
