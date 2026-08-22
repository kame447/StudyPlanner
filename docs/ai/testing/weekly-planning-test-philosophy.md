# 週間計画 AI テスト方針

Status: canonical
Updated: 2026-08-22

References:
- [Human Grounding Policy](../strategy/weekly-planning-human-grounding-dialogue-policy.md)
- [Adaptive Memory Policy](../strategy/weekly-planning-adaptive-memory-learning-policy.md)
- [Current Contract](../weekly-planning-current-contract-v5.md)

## Deterministic tests

AI の自然な日本語や一つの semantic phrasing を universal oracle としない。自動化するのは正誤を決定論的に定義できる contract。

- schema / evidence / reference validity
- binding / Fact Graph lifecycle / revision / idempotency
- pending target / question necessity
- proposal lifecycle / acceptance scope
- current-week / durable promotion boundary
- readiness / scheduler
- preview / approval / save
- persistence / recovery / trace
- security / request / prompt budget

raw Japanese fixtureを deterministic production code が意味再解釈する test を追加しない。

## Renderer

完成済み日本語全文ではなく、typed action identity、grounded context、no invented fact / decision / authorization、未了承 proposal を accepted と話さないことを検査する。

## Real API / human review

model behavior が関係する経路は turn-by-turn で semantic output、accepted delta、Fact Graph、application decision、renderer、scheduler / preview を必要に応じて読む。

明確な意味誤認、context leak、誤binding、未共有 heuristic、未了承 proposal 適用、memory scope leak、off-topic injected response があればその turn で停止する。

## Failure ownership

- semantic meaning error → semantic schema/context/prompt
- representation-only error → deterministic conversion / schema
- validation error → validator
- identity/lifecycle error → binding / Fact Graph
- proposal/question error → deterministic application policy
- placement error → scheduler
- wording-only error → renderer/context
- scope/persistence error → promotion/storage boundary
- harness/env error → harness/environment

症状を隠すため raw user text regex、特定日本語専用 prompt rule、弱い assertion を追加しない。

## Gate

```text
targeted regression
→ typecheck / full tests / build
→ Browser Regression / E2E when relevant
→ Real API + human review when model behavior is relevant
→ exact diff / current HEAD review
```

Security/adversarial evaluation では direct / stored injection、provenance、durable poisoning、Unicode / delimiter、nonsense/no-op、numerical abuse、authorization boundary を attack surface として扱う。
