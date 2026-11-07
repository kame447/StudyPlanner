import { describe, expect, it, vi } from 'vitest';
import type { UserPlanningContextRecordV1 } from '../../../userPlanningContext/userPlanningContextTypes';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import { buildWeeklyPlanningVNextProviderMessages, VNEXT_CONFIRMED_USER_CONTEXT_REQUIREMENT } from '../semantic/weeklyPlanningVNextProviderPrompt';
import { validateVNextProviderLabelEvidence } from '../semantic/weeklyPlanningVNextProviderLabelEvidence';
import type { WeeklyPlanningVNextInterpretationInput } from '../weeklyPlanningVNextInterpretationContract';
import { withoutConfirmedUserContext } from '../application/weeklyPlanningVNextTurnDiagnostics';
import { AI_PROXY_CHAT_REQUEST_LIMITS } from '../../../../../shared/aiProxyContract';
import {
  parseVNextConfirmedUserContext, selectVNextConfirmedUserContext, VNEXT_CONFIRMED_USER_CONTEXT_MAX_BYTES,
  VNEXT_CONFIRMED_USER_CONTEXT_MAX_RECORDS, type VNextConfirmedUserContext,
} from '../weeklyPlanningVNextConfirmedUserContext';

const ORIGINAL = 'ORIGINAL-UTTERANCE-NEVER-COPIED';
const record = (id: string, change: Partial<UserPlanningContextRecordV1> = {}): UserPlanningContextRecordV1 => ({
  id, ownerId: 'alice', kind: 'study_goal', label: `目標${id}`, value: '毎日30分', dateExpression: null, observedDate: '2026-10-01',
  resolvedDate: null, sourceText: ORIGINAL, sourceConversationId: 'conversation-1', sourceTurnId: 'turn-1',
  recordedAt: '2026-10-01T00:00:00.000Z', status: 'active', origin: 'user_confirmed', ...change });
const select = (records: UserPlanningContextRecordV1[], relevantScopeKeys: string[] = []) =>
  selectVNextConfirmedUserContext({ ownerId: 'alice', records, relevantScopeKeys });
const ids = (context: VNextConfirmedUserContext | null) => context?.records.map(item => item.id) ?? [];

describe('confirmed user context selection', () => {
  it('keeps only confirmed, owned, active records and reuses the V5 selector for the rest', () => {
    const context = select([
      record('goal'), record('inferred', { origin: 'ai_inferred' }), record('stated', { origin: 'user_stated' }),
      record('foreign', { ownerId: 'bob' }), record('revoked', { status: 'revoked' }), record('historical', { status: 'historical' }),
      record('math', { kind: 'concern', label: '数学' }), record('english', { kind: 'concern', label: '英語' }),
    ], ['数学']);
    expect(ids(context)).toEqual(['goal', 'math']);
  });

  it('adds no unrelated scoped memory when no typed scope matches, and caps global records at 10', () => {
    const records = [
      ...Array.from({ length: 14 }, (_, index) => record(`g${index}`, { label: `g${index}`, value: null })),
      ...Array.from({ length: 14 }, (_, index) => record(`s${index}`, { kind: 'concern', label: '数学', value: `v${index}` })),
      record('other', { kind: 'concern', label: '英語' }),
    ];
    expect(ids(select(records))).toEqual(Array.from({ length: 10 }, (_, index) => `g${index}`));
    const matched = select(records, ['数学']);
    // The selector allows 10 + 10, but the 4096-byte bound is the tighter limit once records carry their source identifiers.
    expect(ids(matched).filter(id => id.startsWith('g'))).toHaveLength(10);
    expect(ids(matched).filter(id => id.startsWith('s')).length).toBeGreaterThan(0);
    expect(ids(matched)).not.toContain('other');
    expect(new TextEncoder().encode(JSON.stringify(matched)).byteLength).toBeLessThanOrEqual(VNEXT_CONFIRMED_USER_CONTEXT_MAX_BYTES);
  });

  it('never copies the original utterance and keeps the source identifiers', () => {
    const [item] = select([record('goal')])!.records;
    expect(JSON.stringify(item)).not.toContain(ORIGINAL);
    expect(item).toMatchObject({ id: 'goal', origin: 'user_confirmed', observedDate: '2026-10-01',
      recordedAt: '2026-10-01T00:00:00.000Z', sourceConversationId: 'conversation-1', sourceTurnId: 'turn-1' });
  });

  it('keeps the whole JSON within 4096 UTF-8 bytes by leaving out a record whole, never by cutting its text', () => {
    const long = 'あ'.repeat(280);
    const context = select([record('a', { value: long }), record('b', { value: long }), record('c', { value: long }), record('d', { value: long }),
      record('e', { value: long }), record('small', { value: '短い' })]);
    expect(new TextEncoder().encode(JSON.stringify(context)).byteLength).toBeLessThanOrEqual(VNEXT_CONFIRMED_USER_CONTEXT_MAX_BYTES);
    expect(ids(context)).toContain('small');
    expect(ids(context).length).toBeLessThan(6);
    for (const item of context!.records) expect([long, '短い']).toContain(item.value);
  });

  it('bounds the record count', () => {
    const many = Array.from({ length: 40 }, (_, index) => record(`g${index}`, { label: `g${index}`, value: null }));
    expect(select(many)!.records.length).toBeLessThanOrEqual(VNEXT_CONFIRMED_USER_CONTEXT_MAX_RECORDS);
  });

  it('is null for no eligible record so nothing is sent', () => {
    expect(select([])).toBeNull();
    expect(select([record('x', { origin: 'ai_inferred' })])).toBeNull();
  });
});

describe('confirmed user context wire validation (the Worker reads the same shape)', () => {
  const valid = () => structuredClone(select([record('goal'), record('math', { kind: 'concern', label: '数学' })], ['数学'])!);
  it('accepts exactly what the selector produces', () => {
    const context = valid();
    expect(parseVNextConfirmedUserContext(context, 'alice')).toEqual(context);
  });
  it.each<[string, (context: VNextConfirmedUserContext) => unknown]>([
    ['another owner', context => { context.records[0].ownerId = 'bob'; return context; }],
    ['an unconfirmed origin', context => { (context.records[0] as { origin: string }).origin = 'ai_inferred'; return context; }],
    ['the original utterance field', context => ({ records: [{ ...context.records[0], sourceText: ORIGINAL }] })],
    ['an extra top-level key', context => ({ ...context, extra: true })],
    ['a duplicate id', context => ({ records: [context.records[0], context.records[0]] })],
    ['an unknown scope type', context => { (context.records[0].scope as { type: string }).type = 'everything'; return context; }],
    ['an empty list', () => ({ records: [] })],
    ['more than 4096 bytes', context => ({ records: Array.from({ length: 20 }, (_, index) => ({ ...context.records[0], id: `r${index}`, value: 'あ'.repeat(120) })) })],
  ])('rejects %s', (_name, change) => {
    expect(parseVNextConfirmedUserContext(change(valid()), 'alice')).toBeNull();
  });
});

function interpretationInput(confirmedUserContext?: VNextConfirmedUserContext): WeeklyPlanningVNextInterpretationInput {
  const state = createEmptyWeeklyPlanningVNextState();
  return { client: { createChatCompletion: vi.fn() }, state, projection: projectWeeklyPlanningVNext(state), presentedQuestion: null, presentedText: null,
    userText: 'それを予定に入れて', clock: { defaultPlanningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' }, weekStartsOn: 'monday',
      currentDate: '2026-10-30', planningStartDate: '2026-11-02', planningEndDate: '2026-11-08' },
    ...(confirmedUserContext ? { confirmedUserContext } : {}) } as unknown as WeeklyPlanningVNextInterpretationInput;
}

describe('confirmed user context in the generic interpreter request', () => {
  const memory = select([record('goal', { label: '志望校合格', value: '偏差値65' })])!;

  it('leaves a request without memory byte-identical to one that never had the field', () => {
    const plain = buildWeeklyPlanningVNextProviderMessages(interpretationInput());
    expect(JSON.stringify(buildWeeklyPlanningVNextProviderMessages({ ...interpretationInput(), confirmedUserContext: undefined }))).toBe(JSON.stringify(plain));
    expect(plain[0].content).not.toContain(VNEXT_CONFIRMED_USER_CONTEXT_REQUIREMENT);
    expect(plain[1].content).not.toContain('confirmedUserContext');
  });

  it('adds a separate typed channel and the reading rule, without owner or the original utterance', () => {
    const messages = buildWeeklyPlanningVNextProviderMessages(interpretationInput(memory));
    expect(messages[0].content).toContain(VNEXT_CONFIRMED_USER_CONTEXT_REQUIREMENT);
    const body = JSON.parse(messages[1].content) as Record<string, unknown>;
    expect(body.userText).toBe('それを予定に入れて');
    expect(body.confirmedUserContext).toEqual([expect.objectContaining({ id: 'goal', label: '志望校合格', value: '偏差値65', origin: 'user_confirmed',
      sourceConversationId: 'conversation-1', sourceTurnId: 'turn-1' })]);
    expect(messages[1].content).not.toContain(ORIGINAL);
    expect(messages[1].content).not.toContain('"ownerId"');
    expect(body.supplementalContext).toBeNull();
    expect(JSON.stringify(body.activeFacts)).not.toContain('志望校合格');
  });

  it('measures the real request growth at the largest memory, which stays far below the proxy limit', () => {
    const big = select(Array.from({ length: 30 }, (_, index) => record(`g${index}`, { label: `g${index}`, value: 'あ'.repeat(60) })))!;
    const bytes = (messages: unknown) => new TextEncoder().encode(JSON.stringify(messages)).byteLength;
    const without = bytes(buildWeeklyPlanningVNextProviderMessages(interpretationInput()));
    const withMemory = bytes(buildWeeklyPlanningVNextProviderMessages(interpretationInput(big)));
    // The channel (<= 4096 bytes of JSON, minus owner IDs) plus the fixed rule and JSON-in-JSON escaping.
    expect(withMemory - without).toBeLessThanOrEqual(VNEXT_CONFIRMED_USER_CONTEXT_MAX_BYTES + new TextEncoder().encode(VNEXT_CONFIRMED_USER_CONTEXT_REQUIREMENT).byteLength + 512);
    expect(withMemory).toBeLessThan(AI_PROXY_CHAT_REQUEST_LIMITS.maxRequestBodyBytes);
  });

  it('is not evidence for a fact of this utterance: a task or label only memory names is rejected', () => {
    const reading = { delta: { add: [{ kind: 'task', localId: 't', category: 'study', title: '志望校合格' }], patch: [], remove: [], relate: [], defer: [] } };
    const errors = validateVNextProviderLabelEvidence(interpretationInput(memory), reading as never);
    expect(errors).toEqual([expect.objectContaining({ code: 'invalid_value', path: 'labelEvidence', localId: 't' })]);
  });
});

describe('confirmed user context in the trace', () => {
  it('records how much was sent, never the words', () => {
    const memory = select([record('goal', { label: '志望校合格', value: '偏差値65' })])!;
    const request = { purpose: 'weekly_planning', messages: buildWeeklyPlanningVNextProviderMessages(interpretationInput(memory)) };
    const redacted = withoutConfirmedUserContext(request);
    expect(JSON.stringify(redacted)).not.toContain('志望校合格');
    const body = JSON.parse(redacted.messages[1].content) as { confirmedUserContext: unknown; userText: string };
    expect(body.confirmedUserContext).toEqual({ omittedFromTrace: true, records: 1, bytes: expect.any(Number) });
    expect(body.userText).toBe('それを予定に入れて');
    expect(redacted.messages[0]).toBe(request.messages[0]);
  });

  it('returns a request without memory unchanged', () => {
    const request = { messages: buildWeeklyPlanningVNextProviderMessages(interpretationInput()) };
    expect(withoutConfirmedUserContext(request)).toBe(request);
  });
});
