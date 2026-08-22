# weeklyPlanning current contract status

Status: canonical / Stable V5 sole production runtime
Updated: 2026-08-22

Canonical contract: [weekly-planning-current-contract-v5.md](weekly-planning-current-contract-v5.md)
Current roadmap: [strategy/weekly-planning-roadmap.md](strategy/weekly-planning-roadmap.md)
Human grounding: [strategy/weekly-planning-human-grounding-dialogue-policy.md](strategy/weekly-planning-human-grounding-dialogue-policy.md)
Test philosophy: [testing/weekly-planning-test-philosophy.md](testing/weekly-planning-test-philosophy.md)

## Current state

Stable V5 が唯一の production weekly-planning runtime。legacy parser / interpreter / runtime selector は semantic authority ではない。

PR #130 は 2026-08-16 に merge 済み。PR #157 は 2026-08-20 に merge 済み。両 PR の handoff / audit / merge-gate を current execution として再開しない。

PR #162 で主要 UI と dedicated AI planning surface が main へ統合された。semantic ownership は変更しない。

## Current priority

次の independent weekly-planning phase は Issue #152 の adversarial conversation / prompt-injection security evaluation。先に実装を増やすのではなく、current boundary を攻撃して実際に破れた owner layer だけを一般化して修正する。

PR #166 は QA automation infrastructure の独立 draft PR であり feature owner ではない。

## Architecture boundary

AI owns semantic interpretation of raw user language and relevant conversation context.

Deterministic application owns schema/evidence/reference validation, formal binding, Fact Graph lifecycle, revision/idempotency, question necessity/priority, proposal lifecycle, readiness, scheduler, preview, approval/save, persistence/recovery and safety boundaries.

raw Japanese regex / keyword / dictionary / legacy parser で AI semantic output を後段再解釈しない。provider failure時に legacy semantic parser へ fallback しない。

## Maintained contracts

- current-turn semantic delta と accepted state を分離する
- correction / revision / derived progress を lifecycle として扱う
- open-ended work に架空の総量を作らない
- proposal は user acceptance 前に scheduler へ適用しない
- application-internal heuristic と shared ground を分離する
- preview freshness と explicit approval を save 境界で維持する
- existing plans / timetable 等の machine-owned constraint は deterministic scheduler で扱う

## Independent open scopes

- #52 weekly UI responsibility separation
- #152 adversarial / prompt-injection security evaluation
- #164 client-first execution architecture
- #160 AI usage / cost observability
- #128 saved-preview compatibility / migration
- #47 personalization / cloud session authority
- #89 trace production recovery
- #51 multi-device approval uniqueness
- #45 trace privacy / lifecycle

Issue #115 は PR #130 で完了・closed。旧文書の「#115 は別 scope / active」という記述を current status として使わない。
