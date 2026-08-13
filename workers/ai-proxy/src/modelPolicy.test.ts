import { describe, expect, it } from 'vitest';
import {
  AI_CHAT_PURPOSE_MODELS,
  DEFAULT_ALLOWED_CHAT_MODELS,
  WEEKLY_PLANNING_SEMANTIC_REPAIR_MODEL,
  resolveChatModel,
} from './modelPolicy';

describe('ai-proxy chat model policy', () => {
  it('resolves weekly planning purposes to the routed models', () => {
    expect(resolveChatModel({ purpose: 'weekly_planning_interpreter' })).toEqual({
      model: 'gpt-5.4-nano-2026-03-17',
    });
    expect(resolveChatModel({ purpose: 'weekly_planning_semantic_normalizer' })).toEqual({
      model: 'gpt-5.6-luna',
    });
    expect(resolveChatModel({ purpose: 'weekly_planning_renderer' })).toEqual({
      model: 'gpt-5.4-mini-2026-03-17',
    });
  });

  it('keeps weekly planning semantic repair on mini', () => {
    expect(
      resolveChatModel({
        purpose: 'weekly_planning_semantic_normalizer',
        messages: [
          { role: 'system', content: 'Return valid JSON.' },
          { role: 'assistant', content: '{"invalid":true}' },
          {
            role: 'user',
            content: '{"validationErrors":["invalid"],"requiredChanges":["repair"]}',
          },
        ],
      }),
    ).toEqual({ model: 'gpt-5.4-mini-2026-03-17' });
  });

  it('does not classify an ordinary semantic request as repair', () => {
    expect(
      resolveChatModel({
        purpose: 'weekly_planning_semantic_normalizer',
        messages: [
          { role: 'system', content: 'Normalize the user request.' },
          { role: 'user', content: '来週の予定を立てたい' },
        ],
      }),
    ).toEqual({ model: 'gpt-5.6-luna' });
  });

  it('lets purpose win and ignores a client-supplied model for a known purpose', () => {
    expect(
      resolveChatModel({ purpose: 'weekly_planning_interpreter', model: 'gpt-5.4-mini' }),
    ).toEqual({ model: 'gpt-5.4-nano-2026-03-17' });
  });

  it('falls back to the client model when no purpose is given (general NL backward compat)', () => {
    expect(resolveChatModel({ model: 'gpt-5.4-mini' })).toEqual({ model: 'gpt-5.4-mini' });
    expect(resolveChatModel({ model: '  gpt-5.4-mini  ' })).toEqual({ model: 'gpt-5.4-mini' });
  });

  it('errors on an unknown purpose even if a model is also supplied (fail closed)', () => {
    expect(resolveChatModel({ purpose: 'made_up_purpose', model: 'gpt-5.4-mini' })).toEqual({
      error: 'Requested AI purpose is not supported.',
    });
  });

  it('errors when neither purpose nor model resolves a model', () => {
    expect(resolveChatModel({})).toEqual({ error: 'Model is required.' });
    expect(resolveChatModel({ model: '   ' })).toEqual({ error: 'Model is required.' });
  });

  // デプロイ整合の要: purpose 解決後の model は必ず allowlist に含まれていなければ
  // 下流の allowlist 検証で 400 になる。purpose model を追加したらallowlistにも足すこと。
  it('keeps every purpose-routed model inside the default allowlist (no silent 400)', () => {
    for (const model of Object.values(AI_CHAT_PURPOSE_MODELS)) {
      expect(DEFAULT_ALLOWED_CHAT_MODELS).toContain(model);
    }
    expect(DEFAULT_ALLOWED_CHAT_MODELS).toContain(WEEKLY_PLANNING_SEMANTIC_REPAIR_MODEL);
  });
});
