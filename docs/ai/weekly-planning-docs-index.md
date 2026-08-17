# weeklyPlanning documentation index

Status: canonical / active
Updated: 2026-08-18
Current phase: PR #157 final adversarial validation / repeated Real Luna merge gate
Current branch: `agent/issue156-prompt-simplification-adversarial-audit`
Current PR: #157

## 1. この index の役割

この文書は、週間計画まわりの Markdown が増えたことで「どれを current source of truth として読むか」が曖昧になることを防ぐ入口である。

現在の実装判断では、過去 PR の task や historical architecture を先に読まず、current contract、current status、roadmap、現在 task の順で確認する。文書間で記述が衝突した場合は、より新しい current status と current PR task を優先し、その不整合自体を修正対象にする。

## 2. 現行 source of truth

最上位 contract は [weekly-planning-current-contract-v5.md](weekly-planning-current-contract-v5.md) である。Stable V5 sole runtime、AI / deterministic application の責務、Fact Graph、scheduler、preview、approval、save、persistence の境界をここで固定する。

現在位置は [weekly-planning-current-contract-status.md](weekly-planning-current-contract-status.md) を正とする。実装到達点、current PR、別 scope をここで確認する。

全体の実行順序は [strategy/weekly-planning-roadmap.md](strategy/weekly-planning-roadmap.md) を正とする。semantic 固有の長期設計は [strategy/weekly-planning-semantic-v5-roadmap.md](strategy/weekly-planning-semantic-v5-roadmap.md) を参照する。

PR #157 の最終検証と closeout は [tasks/20260818-pr157-final-real-luna-merge-gate.md](tasks/20260818-pr157-final-real-luna-merge-gate.md) を正とする。PR #130 の会話品質監査記録は historical evidence として [tasks/20260814-weekly-planning-conversation-quality-luna-audit.md](tasks/20260814-weekly-planning-conversation-quality-luna-audit.md) を参照できるが、現在の実行順序を決める文書ではない。

会話上の共通基盤と dynamic renderer の mandatory policy は [tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md](tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md) を正とする。

暗記・想起系の proposal、session、復習、durable preference、observed learning profile は [strategy/weekly-planning-adaptive-memory-learning-policy.md](strategy/weekly-planning-adaptive-memory-learning-policy.md) を正とする。

Real Luna の checkpoint / merge-gate 運用と ChatGPT からの起動方法は [testing/weekly-planning-real-api-eval-policy.md](testing/weekly-planning-real-api-eval-policy.md) を正とする。自動テストと human review の一般原則は [testing/weekly-planning-test-philosophy.md](testing/weekly-planning-test-philosophy.md) を参照する。

2026-08-16 の decision-ownership 監査は [audits/20260816-pr130-decision-duplication-adversarial-audit.md](audits/20260816-pr130-decision-duplication-adversarial-audit.md) を historical/current architectural evidence として維持する。

## 3. 推奨する読む順序

```text
current contract v5
→ current contract status
→ current PR #157 task
→ roadmap
→ human grounding / real-API policy
→ 必要な audit / historical evidence
```

この順序にする理由は、過去の migration plan や旧 runtime 前提を current implementation rule と誤認しないためである。

## 4. Current execution

現在の active conversation-quality PR は #157 だけである。Issue #156 の敵対的監査で見つかった typed grounding、question intent、progress、correction、completed-work state などの不足を一般化して修正している。

通常 CI と Browser Regression は green であり、最終 repeated Real Luna merge gate、transcript / Fact Graph review、文書と PR metadata の同期を完了してから merge する。

Real Luna は `.github/weekly-planning-real-api-command.json` の更新で ChatGPT から繰り返し起動できる。通常 source push ごとには heavy matrix を走らせない。

PR #157 完了後の次フェーズは Issue #152 の adversarial conversation / prompt injection security evaluation とする。

Issue #52 の大規模 weekly UI 責務分離と Issue #115 の raw-text regex entry routing は別 scope のまま維持する。

## 5. Task placement rule

現在独立して実行する task は `docs/ai/tasks/` に置く。実装・必要検証が完了した task は `docs/ai/tasks/closed/` へ移す。別の current task へ統合済み、または過去設計としてのみ残すものは `docs/ai/tasks/superseded/` として扱う。

root や task directory にある古い `Status: active` を無条件に信用しない。current contract、current status、current PR task と照合してから利用する。

## 6. Historical / superseded guide

`docs/ai/codex-task-guide.md` は historical filename として残すが、current implementation source of truth ではない。V4 architecture や Codex 固有前提を current rule として使わず、この index と current roadmap を先に参照する。

`strategy/20260814-solid-refactor-roadmap.md` と `tasks/20260814-solid-file-by-file-loop-log.md` は PR #129 の completed structural-hardening evidence として参照できる。

PR #130 task と decision-ownership audit は重要な経緯を持つが、current execution owner は PR #157 task である。

過去の Alpha、feature-flag trial、legacy runtime、fixed scenario quality eval、migration-only task は historical evidence としてのみ扱う。

## 7. Documentation maintenance rule

canonical 文書には現在実装と現在方針だけを書く。完了済み migration plan を current execution source のように残さない。

同じ設計原則を複数 Markdown に全文複製しない。contract は contract、status は現在位置、roadmap は順序、task は実行記録、audit は検証結果という役割に分け、詳細は canonical document への参照でつなぐ。
