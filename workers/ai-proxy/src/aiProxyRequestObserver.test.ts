import { describe, expect, it, vi } from 'vitest';
import {
  classifyAiProxyMetricStatus,
  describeAiProxyOperation,
  observeAiProxyRequest,
} from './aiProxyRequestObserver';

describe('AI proxy request observer', () => {
  it('resolves the actual purpose-routed chat model', () => {
    expect(describeAiProxyOperation('/chat/completions', {
      purpose: 'weekly_planning_semantic_normalizer',
      model: 'ignored-client-model',
      messages: [{ role: 'user', content: 'initial' }],
    }, {})).toEqual({
      operationKind: 'chat_completion',
      provider: 'openai',
      purpose: 'weekly_planning_semantic_normalizer',
      phase: 'initial',
      model: 'gpt-5.6-luna',
    });
  });

  it('describes attachment, transcription and timetable routes without user content', () => {
    expect(describeAiProxyOperation('/planning-attachment', null, {})).toEqual({
      operationKind: 'planning_attachment',
      provider: 'openai',
      purpose: 'weekly_planning_attachment',
      phase: 'single',
      model: 'gpt-5.6-luna',
    });
    expect(describeAiProxyOperation('/planning-transcription', null, {
      OPENAI_TRANSCRIPTION_MODEL: 'gpt-test-transcribe',
    })).toEqual({
      operationKind: 'planning_transcription',
      provider: 'openai',
      purpose: 'planning_transcription',
      phase: 'single',
      model: 'gpt-test-transcribe',
    });
    expect(describeAiProxyOperation('/timetable-ocr', null, {
      GEMINI_MODEL: 'gemini-3.5-flash',
    })).toEqual({
      operationKind: 'timetable_ocr',
      provider: 'gemini',
      purpose: 'timetable_ocr',
      phase: 'single',
      model: 'gemini-3.5-flash',
    });
  });

  it('classifies only provider/quota outcomes and ignores request validation failures', () => {
    expect(classifyAiProxyMetricStatus(200, {})).toBe('success');
    expect(classifyAiProxyMetricStatus(429, {})).toBe('quota_rejected');
    expect(classifyAiProxyMetricStatus(502, { error: 'response content was empty' }))
      .toBe('empty_response');
    expect(classifyAiProxyMetricStatus(502, { error: 'response could not be parsed' }))
      .toBe('invalid_response');
    expect(classifyAiProxyMetricStatus(502, { error: 'OpenAI request failed.' }))
      .toBe('provider_error');
    expect(classifyAiProxyMetricStatus(500, {})).toBe('unknown_failure');
    expect(classifyAiProxyMetricStatus(400, {})).toBeNull();
    expect(classifyAiProxyMetricStatus(401, {})).toBeNull();
  });

  it('does not authenticate or persist anything when observability is unconfigured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      await observeAiProxyRequest({
        request: new Request('https://proxy.example/chat/completions', {
          method: 'POST',
          headers: { Authorization: 'Bearer test-token' },
          body: JSON.stringify({
            purpose: 'weekly_planning_renderer',
            messages: [{ role: 'user', content: 'render' }],
          }),
        }),
        response: new Response(JSON.stringify({ content: 'ok' }), { status: 200 }),
        env: {
          FIREBASE_PROJECT_ID: 'project',
          FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
          FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'private',
          FIREBASE_WEB_API_KEY: 'firebase-key',
          OBSERVABILITY_IDENTITY_SECRET: 'short',
        },
        startedAtMs: 0,
        occurredAt: '2026-08-28T00:00:00.000Z',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
