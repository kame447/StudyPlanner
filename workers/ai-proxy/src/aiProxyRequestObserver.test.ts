import { describe, expect, it } from 'vitest';
import {
  classifyAiProxyMetricStatus,
  describeAiProxyOperation,
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

  it('describes attachment and timetable routes without inspecting user content', () => {
    expect(describeAiProxyOperation('/planning-attachment', null, {})).toEqual({
      operationKind: 'planning_attachment',
      provider: 'openai',
      purpose: 'weekly_planning_attachment',
      phase: 'single',
      model: 'gpt-5.6-luna',
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
});
