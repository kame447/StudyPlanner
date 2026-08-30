# 週間計画 Adaptive Memory Learning Policy

Status: canonical policy
Updated: 2026-08-27
Applies to: 暗記・想起を主要目的とする学習の提案、復習配置、personalization、長期記憶、会話grounding

Parent contract: [../architecture/current-contract-v5.md](../architecture/current-contract-v5.md)
Human grounding: [human-grounding.md](human-grounding.md)
Personalization index: [../personalization/README.md](../personalization/README.md)

## Core rule

一般的な学習heuristicは、ユーザーとのshared groundではない。内部候補を黙ってschedule policyへ昇格せず、必要なら提案として可視化し、accept / modify / reject を経たscopeだけを適用する。

```text
internal heuristic
≠ shared understanding

proposal presented
→ user accepts / modifies / rejects
→ accepted scope may affect scheduling
```

`今回は` / `今週は` と `今後も` / `いつも` を別scopeとして扱い、week-local acceptanceをdurable preferenceへ暗黙昇格させない。

## Learning principles

暗記・想起中心の学習では、cold-start proposalの根拠として次の抽象原則を利用できる。

- 一度にまとめて反復するだけより、時間を空けた再接触が長期保持に有利になりやすい。
- 読み直しだけでなく、思い出す・答える等のretrievalを含む方が長期保持に有利になりやすい。
- session長、復習回数、間隔はユーザー・教材・期限によって変わる。

`1日後・3日後・7日後`、`必ず3周`、`必ず15〜30分` のような固定系列を科学的正解としてhard ruleにしない。

## Session policy

本人の実績・明示希望がない場合、短めのsessionや分散復習をproposal候補にしてよいが、自動採用しない。ユーザーが明示したsession長や配置希望はhard safety/feasibilityを破らない限り一般heuristicより優先する。

新規学習と復習は別責務として扱える。

```text
new acquisition
→ 必要なら比較的まとまった時間を提案

review / retrieval
→ 短め・分散した再接触を提案
```

大量の学習を短時間sessionだけへ強制しない。期限内に現実的に終わらない場合は、全範囲優先、重要範囲優先、新規学習を長め＋復習を分散、期限/目標量変更などのtyped optionをapplicationが提示し、ユーザーに選択させる。

## Placement policy

`暗記なら朝と夜` のような時間帯固定heuristicを標準規則にしない。

配置はhard feasibilityとsoft rankingを混同しない。

まず、authoritative availability / fixed schedule / existing plan / accepted hard temporal or life constraint / `notBefore` を満たすsafe candidate集合だけを残す。explicit preference、durable preference、本人実績、accepted learning proposal、cold-start heuristicのいずれも、このhard gateを越えてfree timeを作ったり、禁止された日時を復活させたりしない。

そのsafe candidate集合の中で順位付けする場合のevidence precedenceは次とする。

1. current turnで明示された時間・曜日・session長
2. durable explicit preference
3. 同種学習の本人実績
4. accepted learning proposal
5. cold-start general heuristic

Cold-start heuristicはcandidate generation/scoringの補助であり、未共有のsemantic preferenceではない。

## Quantity boundary

word/problem/page countは進捗・対象範囲であり、時間そのものではない。語数だけからsession数や総時間を決めない。ユーザーが明示した量、observed throughput、accepted estimate等の根拠がある場合だけ時間推定へ利用する。

## Observation and memory

可能な範囲で生の観測を保存し、単一の倍率だけをsource of truthにしない。

- actual study minutes
- progressed/reviewed quantity
- recall result when available
- elapsed time from prior exposure
- material/component/learning mode
- subjective difficulty when explicitly provided

Memoryを分離する。

- current weekly/conversation state: 今回成立した事実・方針
- durable user preference: 今後も使うことが明示されたowner-scoped preference
- observed learning profile: execution evidenceから導出したprofile/estimate

Observed profileがexplicit preferenceを勝手に書き換えない。衝突時は影響と代替案を提示する。

## Responsibility

AI semantic layer owns meaning such as learning mode, proposal response and scope expressions (`今回は` / `今後も`).

Deterministic application owns proposal lifecycle, accepted scope, memory promotion, observation storage/derivation, readiness and scheduler use. Renderer explains typed decisions but does not invent preference or authorization.

## Quality gate

Tests must protect scope separation and proposal acceptance rather than one fixed Japanese sentence. Model-dependent behavior follows [../quality/real-api-eval-policy.md](../quality/real-api-eval-policy.md).
