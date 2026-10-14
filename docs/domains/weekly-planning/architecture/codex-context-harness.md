# Codex-derived context harness

Status: implementation contract; release status lives in the owning PR / Issue #294.
Updated: 2026-10-15

This document supplements [semantic ownership](weekly-planning-semantic-ownership-boundary-v5.md) and [dialogue architecture](weekly-planning-dialogue-architecture-v5.md). It does not replace their authority rules or the [User Context domain](../../user-context/README.md).

## Upstream and scope

The inspected source is [openai/codex at 1f7fe9b0afb301f895b2d56ae8c05c2cfb19e440](https://github.com/openai/codex/tree/1f7fe9b0afb301f895b2d56ae8c05c2cfb19e440). The reusable structure is session-owned history, per-turn data capture, per-sampling context, immutable prompts, controlled execution, and separately retained host state. The application keeps its existing storage and planning authority; it does not start a parallel agent or memory store.

Two code kernels are actually translated from Rust to TypeScript: the hard-byte UTF-8 head/tail truncation and the serialized-output-budget adjustment loop. Their files carry SPDX / upstream revision notices, and `public/licenses/codex/` distributes the original Apache-2.0 LICENSE and NOTICE plus an adaptation record. The matching upstream golden tests are retained. Context/turn/step classes are adaptations of responsibility boundaries, not literal ports of the entire Codex engine.

The alternative of running the Codex CLI or its process-spawning SDK would require an OS execution environment unavailable in the browser or ordinary Workers. It would also add unrelated shell/file permissions. Renaming the old four-message slicing as a context manager would not address the data-flow problem. Neither alternative is used.

## Mapping to production

The existing chat store and runtime session remain the equivalents of SessionState: full messages, graph revisions, pending questions and explicit approvals stay with their current owners. `PlanningContextManager` creates a model-only view of those messages. It neither persists nor modifies them, and it does not make a generated summary authoritative.

`capturePlanningTurnContext` implements the TurnContext boundary at browser execution, selected-candidate continuation and durable Worker ingress. It clones and freezes JSON-like data before asynchronous work. Source arrays remain editable by the UI. The original live cancellation and semantic telemetry capabilities are kept outside the cloned data, so freezing the snapshot cannot turn an expired request into an authorized one.

`PlanningModelStep` captures the data for one model stage. `PlanningModelPrompt` captures its exact role/content messages and byte size. Both semantic interpretation and renderer use these boundaries. Renderer output validation uses the same captured input that generated the request, not a later mutable caller object. A repair request appends its instruction to a new prompt; it cannot overwrite the original request. Transport adapters receive copies. Existing provider purposes, call ceilings and recovery checks remain in place.

The application retains the equivalent of ToolRouter / execution policy in its existing typed semantic pipeline, scheduler, candidate continuation, controller and approval application. Read-only context is not a save capability. Models still cannot grant owner IDs, graph revisions, question freshness or approval. No shell, unrestricted tool loop, automatic plan-save tool, new provider or new model call is introduced.

## History policy

Both semantic interpretation and ordinary response generation use the same history projection instead of independently retaining the last four messages. The default history budget is 8,192 UTF-8 bytes of the serialized role/content array, including JSON escaping. Short conversations can retain more than four messages. When the budget is exceeded, the oldest complete user-initiated exchanges are omitted. An assistant answer is never detached from a user message by cutting the selected suffix in the middle of an exchange.

Messages are not partially rewritten to fit: this avoids turning a truncated negation into a different instruction. If even the newest whole exchange is too large, no partial version is supplied as complete conversation. The window records original, retained and omitted counts and bytes. Full messages remain available to the existing question-freshness and provenance machinery. Current user input, accepted facts and pending authority are not replaced by the history window.

This is a history budget, not a promise that the entire model prompt is 8 KiB. Existing limits for structured state, reference selectors and provider input remain separate. The approximate token number uses Codex's ceil(UTF-8 bytes / 4) heuristic; it is not an exact Japanese tokenizer or a cost metric. LLM-generated compaction and cross-conversation retrieval are not implemented by this change.

## Diagnostic ownership and transport

Durable Worker response-generation prompts are captured in an invocation-local map and attached to that invocation's result. Concurrent owners using the same action/request text cannot share this prompt map. The browser's existing prompt adapter remains compatible. An explicitly attached context does not consume another context from the legacy process-level cache.

Exact generated role/content messages enter the trace. Renderer retries include their attempted prompt. Oversized diagnostic text uses the upstream UTF-8 port; oversized JSON is scaled against its fully serialized size, so escaping cannot unexpectedly exceed the limit. The trace keeps truncation metadata and its independent success/failure fields. This loss-aware diagnostic truncation is never fed back into the graph as planning evidence.

The trace contract is exercised with the actual shared semantic-to-renderer runtime and an injected provider: matching history windows, caller edits during a model wait, concurrent owners, first append failure, persistent outbox replay, Worker preparation, client/server byte limits, unknown future fields and very large escaped values. Existing business, security and approval tests remain required.

## Compatibility and release

No chat, graph, user-memory or approval storage schema is migrated. Old snapshots use the new model projection on their next request, while their full source messages remain unchanged. Rollback restores the prior projection without needing to recreate stored conversations. Source snapshots expire with the existing request/controller guards; this change does not claim to complete the separate app-wide forget/revocation programme in Issue #294.

Both Pages and the durable weekly-turn Worker execute the shared code. Release verification must therefore check the correct deployed commit for both environments, preserving current Worker bindings and secrets. The owner-reference selector and collaborative writing instructions are separate changes (#658 and successor #662); this harness consumes their ordinary renderer data without implementing another selector.
