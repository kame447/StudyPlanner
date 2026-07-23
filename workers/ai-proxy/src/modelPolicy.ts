// Cloudflare AI Proxy の chat model 選択 policy(純ロジック・Worker ランタイム非依存)。
// index.ts から import して使う。`cloudflare:workers` に依存しないため単体テスト可能。
//
// 用途(purpose / operation)→ model の single source of truth。
// frontend は purpose だけを送り、具体 model 名を自由指定しない。resolveChatModel が解決した
// model は、呼び出し側(index.ts)で必ず allowlist(ALLOWED_CHAT_MODELS)に含まれることを
// 検証してから OpenAI へ送る(purpose 由来でも allowlist をバイパスしない)。

export const AI_CHAT_PURPOSE_MODELS: Record<string, string> = {
  weekly_planning_interpreter: 'gpt-5.4-nano-2026-03-17',
  weekly_planning_semantic_normalizer: 'gpt-5.4-nano-2026-03-17',
  weekly_planning_renderer: 'gpt-5.4-mini-2026-03-17',
};

// ALLOWED_CHAT_MODELS env が未設定のときの既定 allowlist。
// AI_CHAT_PURPOSE_MODELS の全 model を必ず含めること(purpose 解決後にallowlist検証で弾かれないため)。
export const DEFAULT_ALLOWED_CHAT_MODELS = [
  'gpt-5.4-mini',
  'gpt-5.4-nano-2026-03-17',
  'gpt-5.4-mini-2026-03-17',
];

export interface ChatModelResolutionInput {
  model?: string;
  purpose?: string;
}

export function resolveChatModel(
  payload: ChatModelResolutionInput,
): { model: string } | { error: string } {
  const purpose = typeof payload.purpose === 'string' ? payload.purpose.trim() : '';

  if (purpose) {
    const policyModel = AI_CHAT_PURPOSE_MODELS[purpose];

    if (!policyModel) {
      return { error: 'Requested AI purpose is not supported.' };
    }

    return { model: policyModel };
  }

  const model = typeof payload.model === 'string' ? payload.model.trim() : '';

  if (!model) {
    return { error: 'Model is required.' };
  }

  return { model };
}
