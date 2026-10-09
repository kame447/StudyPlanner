import { describe, expect, it, vi } from 'vitest';
import {
  checkShownQuestionPurposeV5, createShownQuestionPurposeCheckMessagesV5, createShownQuestionPurposeCheckV5, parseShownQuestionPurposeV5,
  permitsBareBudgetPromotionV5, SHOWN_QUESTION_PURPOSE_CHECK_MAX_COMPLETION_TOKENS, SHOWN_QUESTION_PURPOSE_CHECK_REQUEST_MAX_BYTES,
} from './weeklyPlanningShownQuestionPurposeCheck';

const client = (reply: string | Error) => ({ createChatCompletion: vi.fn(async () => { if (reply instanceof Error) throw reply; return reply; }) });
const Q = '卒業研究ノートは今週どのくらい進めたいですか？';

describe('shown-question purpose check (S3a v2)', () => {
  it('reads the question text alone: the request carries the question and nothing of the user\'s answer or declarations', () => {
    const messages = createShownQuestionPurposeCheckMessagesV5(Q);
    expect(JSON.parse(messages[1].content)).toEqual({ question: Q });
    expect(messages[1].content).not.toContain('validationErrors');
    expect(new TextEncoder().encode(JSON.stringify({ messages })).byteLength).toBeLessThanOrEqual(SHOWN_QUESTION_PURPOSE_CHECK_REQUEST_MAX_BYTES);
    expect(messages[0].content).toContain('When unsure, answer other');
  });
  it.each(['progress', 'plan', 'other'] as const)('returns the enum %s from a strict answer', async (purpose) => {
    const c = client(JSON.stringify({ purpose }));
    await expect(checkShownQuestionPurposeV5({ client: c, questionText: Q })).resolves.toBe(purpose);
    expect(c.createChatCompletion).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['malformed', 'not json'],
    ['unknown value', JSON.stringify({ purpose: 'planning' })],
    ['extra key', JSON.stringify({ purpose: 'plan', reason: 'x' })],
    ['array', '[]'],
  ])('%s → unavailable, never a promotion', async (_name, reply) => {
    const result = await checkShownQuestionPurposeV5({ client: client(reply), questionText: Q });
    expect(result).toBe('unavailable');
    expect(permitsBareBudgetPromotionV5(result)).toBe(false);
  });
  it('a provider error or a dispatch refusal → unavailable', async () => {
    await expect(checkShownQuestionPurposeV5({ client: client(new Error('provider')), questionText: Q })).resolves.toBe('unavailable');
  });
  it('an empty question makes no call and is unavailable', async () => {
    const c = client(JSON.stringify({ purpose: 'plan' }));
    await expect(checkShownQuestionPurposeV5({ client: c, questionText: '  ' })).resolves.toBe('unavailable');
    expect(c.createChatCompletion).not.toHaveBeenCalled();
  });
  it('only `plan` permits promotion', () => {
    expect(['plan', 'progress', 'other', 'unavailable'].map(r => permitsBareBudgetPromotionV5(r as never))).toEqual([true, false, false, false]);
    expect(parseShownQuestionPurposeV5('{"purpose":"plan"}')).toBe('plan');
  });
  it('the factory yields the agreed (questionText) => enum function and calls the strict schema once', async () => {
    const c = client(JSON.stringify({ purpose: 'plan' }));
    const check = createShownQuestionPurposeCheckV5(c);
    await expect(check(Q)).resolves.toBe('plan');
    const request = (c.createChatCompletion.mock.calls[0] as unknown as [{ responseFormat: { json_schema: { name: string } }; purpose: string }])[0];
    expect(request.responseFormat.json_schema.name).toBe('weekly_planning_shown_question_purpose_v5');
    expect(request.purpose).toBe('weekly_planning_semantic_normalizer');
    // The budget includes reasoning tokens (observed up to 264): it must stay well above them or the call ends empty.
    expect(SHOWN_QUESTION_PURPOSE_CHECK_MAX_COMPLETION_TOKENS).toBeGreaterThanOrEqual(512);
    expect((request as unknown as { maxCompletionTokens: number }).maxCompletionTokens).toBe(SHOWN_QUESTION_PURPOSE_CHECK_MAX_COMPLETION_TOKENS);
  });
});
