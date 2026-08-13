import { describe, expect, it } from 'vitest';
import {
  AI_CHAT_PURPOSE_MODELS,
  DEFAULT_ALLOWED_CHAT_MODELS,
  resolveChatModel,
} from './modelPolicy';

describe('ai-proxy chat model policy', () => {
  it('routes every weekly planning OpenAI purpose to Luna', () => {
    for (const purpose of [
      'weekly_planning_interpreter',
      'weekly_planning_semantic_normalizer',
      'weekly_planning_renderer',
    ]) {
      expect(resolveChatModel({ purpose })).toEqual({ model: 'gpt-5.6-luna' });
    }
  });

  it('keeps semantic repair on the same Luna purpose route', () => {
    expect(
      resolveChatModel({
        purpose: 'weekly_planning_semantic_normalizer',
        model: 'gpt-5.4-mini',
      }),
    ).toEqual({ model: 'gpt-5.6-luna' });
  });

  it('lets purpose win and ignores a client-supplied model for a known purpose', () => {
    expect(
      resolveChatModel({ purpose: 'weekly_planning_interpreter', model: 'gpt-5.4-mini' }),
    ).toEqual({ model: 'gpt-5.6-luna' });
  });

  it('falls back to the client model when no purpose is given (general NL backward compat)', () => {
    expect(resolveChatModel({ model: 'gpt-5.6-luna' })).toEqual({ model: 'gpt-5.6-luna' });
    expect(resolveChatModel({ model: '  gpt-5.6-luna  ' })).toEqual({ model: 'gpt-5.6-luna' });
  });

  it('errors on an unknown purpose even if a model is also supplied (fail closed)', () => {
    expect(resolveChatModel({ purpose: 'made_up_purpose', model: 'gpt-5.6-luna' })).toEqual({
      error: 'Requested AI purpose is not supported.',
    });
  });

  it('errors when neither purpose nor model resolves a model', () => {
    expect(resolveChatModel({})).toEqual({ error: 'Model is required.' });
    expect(resolveChatModel({ model: '   ' })).toEqual({ error: 'Model is required.' });
  });

  it('keeps every purpose-routed model inside the default allowlist', () => {
    expect(new Set(Object.values(AI_CHAT_PURPOSE_MODELS))).toEqual(new Set(['gpt-5.6-luna']));
    expect(DEFAULT_ALLOWED_CHAT_MODELS).toEqual(['gpt-5.6-luna']);
  });
});
