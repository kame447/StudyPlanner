import { describe, expect, it, vi } from 'vitest';
import { createUserContextRoutingLunaEvaluator } from './userContextRoutingLunaEvaluation';

function completion(content: unknown) {
  return Response.json({
    model: 'gpt-5.6-luna',
    choices: [{ message: { content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 140, completion_tokens: 30 },
  });
}

describe('user-context routing Luna evaluator', () => {
  it('uses the production interpreter schema and returns typed target ownership', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => completion({
      targetDomain: 'bookshelf',
      kind: null,
      label: null,
      value: null,
      dateExpression: null,
      displayText: '金フレは120ページまで進んだ。',
      reason: '教材進捗は本棚が正本',
    }));
    const result = await createUserContextRoutingLunaEvaluator({
      apiKey: 'test-key',
      fetch: fetchMock,
    }).evaluate('金フレは120ページまで進んだ');

    expect(result).toMatchObject({
      status: 'evaluated',
      interpretation: { targetDomain: 'bookshelf' },
      metadata: { promptTokens: 140, completionTokens: 30 },
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.model).toBe('gpt-5.6-luna');
    expect(body.response_format.json_schema.name)
      .toBe('studyplanner_user_context_interpretation_v2');
    expect(JSON.parse(body.messages[1].content)).toEqual({
      text: '金フレは120ページまで進んだ',
      existingRecord: null,
    });
  });

  it.each([
    ['invalid JSON', () => new Response('{', { status: 200 }), 'invalid_json'],
    ['HTTP 429', () => Response.json({}, { status: 429 }), 'http'],
  ] as const)('returns a controlled result for %s', async (_name, response, reason) => {
    const result = await createUserContextRoutingLunaEvaluator({
      apiKey: 'test-key',
      fetch: vi.fn(async () => response()),
    }).evaluate('test');
    expect(result).toMatchObject({ reason });
  });

  it('rejects a schema-invalid interpretation', async () => {
    const result = await createUserContextRoutingLunaEvaluator({
      apiKey: 'test-key',
      fetch: vi.fn(async () => completion({
        targetDomain: 'actual',
        kind: 'concern',
        label: 'wrong',
        value: null,
        dateExpression: null,
        displayText: 'invalid',
        reason: 'invalid mixed fields',
      })),
    }).evaluate('test');
    expect(result).toMatchObject({ status: 'invalid', reason: 'invalid_response' });
  });
});
