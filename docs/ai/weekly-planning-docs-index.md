# weeklyPlanning documentation index

Status: canonical / active
Updated: 2026-08-16
Current phase: Stable V5 conversation-quality audit / Luna simplification / decision-ownership cleanup
Current branch: `agent/weekly-conversation-quality-luna-audit`
Current PR: #130

## 1. この index の役割

この文書は、週間計画まわりの Markdown が増えたことで「どれを current source of truth として読むか」が曖昧になることを防ぐ入口である。

現在の実装判断では、過去 PR の task や historical architecture を先に読まず、current contract、current status、roadmap、現在 task の順で確認する。文書間で記述が衝突した場合は、より新しい current status と current PR task を優先し、その不整合自体を修正対象にする。

## 2. 現行 source of truth

最上位 contract は [weekly-planning-current-contract-v5.md](weekly-planning-current-contract-v5.md) である。Stable V5 sole runtime、AI / deterministic application の責務、Fact Graph、scheduler、preview、approval、save、persistence の境界をここで固定する。

現在位置は [weekly-planning-current-contract-status.md](weekly-planning-current-contract-status.md) を正とする。実装到達点、current PR、別 scope をここで確認する。

全体の実行順序は [strategy/weekly-planning-roadmap.md](strategy/weekly-planning-roadmap.md) を正とする。semantic 固有の長期設計は [strategy/weekly-planning-semantic-v5-roadmap.md](strategy/weekly-planning-semantic-v5-roadmap.md) を参照する。

PR #130 の実行記録と会話品質監査は [tasks/20260814-weekly-planning-conversation-quality-luna-audit.md](tasks/20260814-weekly-planning-conversation-quality-luna-audit.md) を正とする。会話上の共通基盤と dynamic renderer の mandatory policy は [tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md](tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md) を正とする。

暗記・想起系の proposal、session、復習、durable preference、observed learning profile は [strategy/weekly-planning-adaptive-memory-learning-policy.md](strategy/weekly-planning-adaptive-memory-learning-policy.md) を正とする。

自動テストと real-API human review の境界は [testing/weekly-planning-test-philosophy.md](testing/weekly-planning-test-philosophy.md) を正とする。

2026-08-16 時点の decision-ownership 監査は [audits/20260816-pr130-decision-duplication-adversarial-audit.md](audits/20260816-pr130-decision-duplication-adversarial-audit.md) を正とする。次のリファクタリングではコード行数ではなく「同じ意味の判断が何箇所に存在するか」を主要指標として使う。

## 3. 推奨する読む順序

```text
current contract v5
→ current contract status
→ current PR #130 task
→ PR #130 adversarial decision-duplication audit
→ human grounding policy / adaptive memory policy
→ test philosophy
→ roadmap
→ 必要な architecture / historical evidence
```

この順序にする理由は、過去の migration plan や旧 runtime 前提を current implementation rule と誤認しないためである。

## 4. Current execution

PR #109、#112、#113、#120、#127、#129 までで Stable V5 production 一本化、legacy runtime 削除、semantic ownership、human grounding、scheduler hardening、Browser Regression、file-by-file SOLID hardening を main へ統合済みである。

現在は PR #130 で Luna を用いた turn-by-turn real-API 会話監査、旧 model 時代の heuristic / prompt scaffolding の削減、adaptive memory policy の整理、最終 preview 会話の検証を進めている。

2026-08-16 の敵対的監査により、次の構造作業では prompt の文字数削減だけでなく、effort question、next conversational action、scheduler readiness、preview authorization compatibility の decision ownership を優先して確認する。

Issue #52 の大規模 weekly UI 責務分離と Issue #115 の raw-text regex entry routing は別 scope のまま維持する。PR #130 の Markdown や PR metadata がこれと矛盾する場合は、merge 前に current roadmap 側へ合わせる。

## 5. Task placement rule

現在独立して実行する task は `docs/ai/tasks/` に置く。実装・必要検証が完了した task は `docs/ai/tasks/closed/` へ移す。別の current task へ統合済み、または過去設計としてのみ残すものは `docs/ai/tasks/superseded/` として扱う。

root や task directory にある古い `Status: active` を無条件に信用しない。current contract、current status、current PR task と照合してから利用する。

## 6. Historical / superseded guide

`docs/ai/codex-task-guide.md` は historical filename として残すが、current implementation source of truth ではない。V4 architecture や Codex 固有前提を current rule として使わず、この index と current roadmap を先に参照する。

`strategy/20260814-solid-refactor-roadmap.md` と `tasks/20260814-solid-file-by-file-loop-log.md` は PR #129 の completed structural-hardening evidence として参照できるが、PR #130 の実行順序を決める source ではない。

過去の Alpha、feature-flag trial、legacy runtime、fixed scenario quality eval、migration-only task は historical evidence としてのみ扱う。

## 7. Documentation maintenance rule

canonical 文書には現在実装と現在方針だけを書く。完了済み migration plan を current execution source のように残さない。

同じ設計原則を複数 Markdown に全文複製しない。contract は contract、status は現在位置、roadmap は順序、task は実行記録、audit は検証結果という役割に分け、詳細は canonical document への参照でつなぐ。

特に AI / deterministic application の責務境界、human grounding、adaptive memory policy を各文書へ何度も長文転記しない。文書側でも「同じ意味の判断を複数箇所が所有しない」というコードと同じ原則を適用する。
