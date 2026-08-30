# 週間計画 AI テスト方針

Status: canonical
Updated: 2026-08-27

References:
- [Human Grounding Policy](../policies/human-grounding.md)
- [Scheduling Policy](../policies/scheduling.md)
- [Adaptive Memory Policy](../policies/adaptive-memory.md)
- [Current Contract](../architecture/current-contract-v5.md)
- [Regression scenario catalog](regression-scenarios.md)
- [Real API evaluation policy](real-api-eval-policy.md)

## Deterministic tests

AIの自然な日本語や一つのsemantic phrasingをuniversal oracleとしない。自動化するのは正誤を決定論的に定義できるcontract。

- schema/evidence/reference validity
- binding/Fact Graph lifecycle/revision/idempotency
- quantity/progress derivation and convergence
- task decomposition / atomicity
- pending target/question necessity
- repair agenda / defer / reopen boundary
- proposal lifecycle/acceptance scope
- current-week/durable promotion boundary
- authoritative availability / not-before / scheduling distribution
- hard temporal bound resolution / target applicability / scheduler-input compilation
- reserve/slack behavior when the resulting horizon is exactly seven days
- readiness/scheduler
- preview/approval/save
- persistence/recovery/trace
- security/request/prompt budget

raw Japanese fixtureをdeterministic production codeが意味再解釈するtestを追加しない。

## Regression scenario ownership

Version非依存の主要scenarioは [regression-scenarios.md](regression-scenarios.md) をcurrent catalogとする。

Historical V4 roleplay、closed task、auditが重要なfailure caseを持っていても、その文書をcurrent test planへ戻さない。現在も必要なinvariantだけをscenario catalogへ抽出し、current Stable V5 code/testへ対応付ける。

特に次を「古い実装詳細」と誤認して落とさない。

- resulting planning horizonが7日間の場合のcurrent reserve/slack behavior
- accepted hard temporal boundをdefault 7日で切り捨てず、task/component scopeを越えて漏らさないこと
- request-timeより前へ配置しないこと
- existing plans/timetable/life hard constraintsを空き時間にしないこと
- progress / remaining / current targetの分離
- atomic work integrity
- blocking repairとlow-impact deferの分離
- stale preview / pending proposal / approval idempotency
- current-week acceptanceとdurable memoryの分離

## Property / metamorphic tests

入力例の一点一致だけでなく、domain invariantが変形後も成立することを検査する。

適用例:

- bounded progressの入力順序を入れ替えても同じactive factsなら同じremainingへ収束する
- irrelevant factを追加しても独立なhard constraintが変化しない
- derivation/projectionがsource inputを暗黙mutateしない
- preference/annotationを追加してもhard availabilityが拡大しない
- retry/reloadで同一operationがduplicate semantic/save effectを作らない

ただし、会話turnすべてが可換だとは仮定しない。correction、revision、明示的なtemporal/lifecycle orderingは各contractに従う。

## Renderer

完成済み日本語全文ではなく、typed action identity、grounded context、no invented fact/decision/authorization、未了承proposalをacceptedと話さないことを検査する。

applicationがdeferしたuncertaintyをrendererが勝手にblocking questionへ戻したり、未解決stateを解決済みと話したりしないことも確認する。

## Real API / human review

model behaviorが関係する経路はturn-by-turnでsemantic output、accepted delta、Fact Graph、repair agenda、application decision、renderer、scheduler/previewを必要に応じて読む。

明確な意味誤認、context leak、誤binding、未共有heuristic、未了承proposal適用、memory scope leak、off-topic injected responseがあればそのturnで停止する。

## Failure ownership

- semantic meaning error → semantic schema/context/prompt
- representation-only error → deterministic conversion/schema
- validation error → validator
- identity/lifecycle error → binding/Fact Graph
- proposal/question/repair priority error → deterministic application policy
- availability/placement/distribution error → scheduler
- wording-only error → renderer/context
- scope/persistence error → promotion/storage boundary
- harness/env error → harness/environment

症状を隠すためraw user text regex、特定日本語専用prompt rule、弱いassertionを追加しない。

## Gate

```text
targeted regression
→ relevant property/metamorphic checks
→ typecheck / full tests / build
→ Browser Regression / E2E when relevant
→ Real API + human review when model behavior is relevant
→ exact diff / current HEAD review
```

Security/adversarial evaluationではdirect/stored injection、provenance、durable poisoning、Unicode/delimiter、nonsense/no-op、numerical abuse、authorization boundaryをattack surfaceとして扱う。
