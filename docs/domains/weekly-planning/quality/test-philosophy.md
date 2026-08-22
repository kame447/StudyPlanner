# 週間計画 AI テスト方針

Status: canonical
Updated: 2026-08-22

References:
- [Human Grounding Policy](../policies/human-grounding.md)
- [Adaptive Memory Policy](../policies/adaptive-memory.md)
- [Current Contract](../architecture/current-contract-v5.md)
- [Real API evaluation policy](real-api-eval-policy.md)

## Deterministic tests

AIの自然な日本語や一つのsemantic phrasingをuniversal oracleとしない。自動化するのは正誤を決定論的に定義できるcontract。

- schema/evidence/reference validity
- binding/Fact Graph lifecycle/revision/idempotency
- pending target/question necessity
- proposal lifecycle/acceptance scope
- current-week/durable promotion boundary
- readiness/scheduler
- preview/approval/save
- persistence/recovery/trace
- security/request/prompt budget

raw Japanese fixtureをdeterministic production codeが意味再解釈するtestを追加しない。

## Renderer

完成済み日本語全文ではなく、typed action identity、grounded context、no invented fact/decision/authorization、未了承proposalをacceptedと話さないことを検査する。

## Real API / human review

model behaviorが関係する経路はturn-by-turnでsemantic output、accepted delta、Fact Graph、application decision、renderer、scheduler/previewを必要に応じて読む。

明確な意味誤認、context leak、誤binding、未共有heuristic、未了承proposal適用、memory scope leak、off-topic injected responseがあればそのturnで停止する。

## Failure ownership

- semantic meaning error → semantic schema/context/prompt
- representation-only error → deterministic conversion/schema
- validation error → validator
- identity/lifecycle error → binding/Fact Graph
- proposal/question error → deterministic application policy
- placement error → scheduler
- wording-only error → renderer/context
- scope/persistence error → promotion/storage boundary
- harness/env error → harness/environment

症状を隠すためraw user text regex、特定日本語専用prompt rule、弱いassertionを追加しない。

## Gate

```text
targeted regression
→ typecheck / full tests / build
→ Browser Regression / E2E when relevant
→ Real API + human review when model behavior is relevant
→ exact diff / current HEAD review
```

Security/adversarial evaluationではdirect/stored injection、provenance、durable poisoning、Unicode/delimiter、nonsense/no-op、numerical abuse、authorization boundaryをattack surfaceとして扱う。