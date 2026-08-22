# 週間計画 AI ロードマップ

Status: canonical / execution order
Updated: 2026-08-22

Current contract: [../weekly-planning-current-contract-v5.md](../weekly-planning-current-contract-v5.md)
Current status: [../weekly-planning-current-contract-status.md](../weekly-planning-current-contract-status.md)
Current priority: Issue #152 — Stable V5 adversarial conversation / prompt-injection security evaluation
Human grounding policy: [weekly-planning-human-grounding-dialogue-policy.md](weekly-planning-human-grounding-dialogue-policy.md)
Adaptive memory policy: [weekly-planning-adaptive-memory-learning-policy.md](weekly-planning-adaptive-memory-learning-policy.md)
Test philosophy: [../testing/weekly-planning-test-philosophy.md](../testing/weekly-planning-test-philosophy.md)

## Completed baseline

PR #109、#112、#113、#120、#127、#129、#130、#132、#140〜#151、#154、#155、#157 で Stable V5 production 一本化、legacy semantic runtime の production 到達不能化、Fact lifecycle、scheduler / preview / approval boundary、conversation-quality hardening を main へ統合した。

PR #162 で主要 UI と dedicated AI planning surface を統合した。これは Stable V5 semantic ownership を変更しない。

## Current priority: #152

実装を先に足さず direct / stored prompt injection、durable context poisoning、current-turn provenance、renderer integrity、nonsense/no-op、Unicode / delimiter、numerical/resource abuse で current boundary を攻撃する。

実際に破れた箇所だけ owner layer で一般化し、raw Japanese injection keyword detector や症例専用 fixed response で塞がない。

```text
current main / contract refresh
→ threat case inventory
→ attack + evidence
→ owning layer classification
→ targeted deterministic regression
→ generalized fix
→ relevant Real API / browser verification
→ canonical docs sync
→ final CI / Browser Regression
→ Issue #152 close decision
```

## Independent scopes

Issue #52 の weekly UI responsibility separation は未完。PR #162 で dedicated AI surface は成立したが generic QuickEntry への weekly-planning application/callback plumbing が残る。

privacy / personalization、cross-device approval uniqueness、saved-preview migration、trace privacy/recovery、client-first execution、AI cost observability は各 open Issue と canonical task の owner を維持する。

PR #166 の QA automation infrastructure は cross-cutting 独立 PR。feature owner ではないが、merge 後は追加 quality gate を検証 evidence として利用する。

## Architecture direction

一つの意味判断に一つの owner を置く。

```text
semantic meaning
→ canonical typed state
→ one deterministic application decision owner
→ immutable typed decision
→ renderer / compatibility / trace projection
```

prompt や file 数だけを複雑性指標にせず、同じ decision が複数 layer で再導出されていないかを優先して監査する。
