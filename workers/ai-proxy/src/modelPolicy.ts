// Cloudflare AI Proxy の chat model 選択 policy(純ロジック・Worker ランタイム非依存)。
// index.ts から import して使う。`cloudflare:workers` に依存しないため単体テスト可能。
//
// 用途(purpose / operation)→ model の single source of truth。
// frontend は purpose だけを送り、具体 model 名を自由指定しない。resolveChatModel が解決した
// model は、呼び出し側(index.ts)で必ず allowlist(ALLOWED_CHAT_MODELS)に含まれることを
// 検証してから OpenAI へ送る(purpose 由来でも allowlist をバイパスしない)。

const INTERNAL_OPENAI_MODEL = 'gpt-5.6-luna';

export const AI_CHAT_PURPOSE_MODELS: Record<string, string> = {
  weekly_planning_interpreter: INTERNAL_OPENAI_MODEL,
  weekly_planning_semantic_normalizer: INTERNAL_OPENAI_MODEL,
  weekly_planning_renderer: INTERNAL_OPENAI_MODEL,
};

// OCR は Gemini 経路で別管理する。OpenAI chat は内部用途を Luna に統一する。
export const DEFAULT_ALLOWED_CHAT_MODELS = [INTERNAL_OPENAI_MODEL];

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
