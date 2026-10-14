# OpenAI Codex portions included in Laplance

Upstream: https://github.com/openai/codex
Pinned revision: 1f7fe9b0afb301f895b2d56ae8c05c2cfb19e440
License: Apache License 2.0. The upstream LICENSE and NOTICE are retained beside this file.

`src/features/weeklyPlanning/harness/codexUtf8Budget.ts` is a TypeScript adaptation of `codex-rs/utils/string/src/truncate.rs`, specifically `truncate_middle_with_marker`, byte-boundary budget splitting and the approximate byte/token estimator. The four upstream hard-budget golden tests from `codex-rs/utils/string/src/truncate/tests.rs` are also ported. TextEncoder/TextDecoder replace Rust UTF-8 string slices, JS invalid budgets are rejected, and BOM characters are retained. This is Unicode scalar-boundary handling, not grapheme-cluster segmentation. The estimator is heuristic, not a tokenizer or a billing calculation.

`src/features/weeklyPlanning/harness/codexJsonPreview.ts` adapts the iterative serialized-size adjustment from `codex-rs/utils/output-truncation/src/lib.rs::truncate_mcp_tool_result`. Laplance keeps its own traceTruncated/originalBytes/jsonHead/jsonTail envelope instead of the MCP return type. Error/success status is preserved outside the truncated payload. Its minimum byte budget must accommodate that envelope.

The Session/Turn/Step/ContextManager/Prompt responsibility separation is an architectural adaptation, not a claim to have ported those Rust subsystems or the entire Codex agent. Laplance retains its own chat storage, validated semantic state, deterministic planning, permissions, approval and save machinery. No Codex executable, operating-system sandbox, terminal tool or Ratatui code is included in these portions.

Modifications and integration into Laplance: 2026.
