/**
 * AI chat の「用途(purpose / operation)」識別子。
 *
 * 具体的な model 名はここで持たない。用途 → model の対応は Cloudflare Worker
 * (`workers/ai-proxy/src/modelPolicy.ts` の `AI_CHAT_PURPOSE_MODELS`)を
 * single source of truth とする。二重定義による drift を避けるため、frontend は
 * purpose だけを Worker へ送り、具体的な model 名を自由指定しない。
 *
 * 直結(非 proxy / dev)経路には Worker が無いため、model は既存の `config.model`
 * を使う dev-only fallback とする。本番の用途別 routing は Worker のみが担う。
 */
export type AiChatPurpose =
  | 'weekly_planning_interpreter'
  | 'weekly_planning_semantic_normalizer'
  | 'weekly_planning_renderer'
  | 'user_context_interpreter';
