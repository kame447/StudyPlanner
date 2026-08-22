# タスク md テンプレート

`docs/ai/tasks/` に未完了 task を作るときのテンプレート。agent 固有の指示ではなく、単一の主原因・責務境界・完了条件を持つ work unit とする。

- filename: `docs/ai/tasks/YYYYMMDD-<slug>.md`
- active task だけを `tasks/` 直下へ置く。
- 完了後は `tasks/closed/` へ、置換済みは `tasks/superseded/` へ移す。
- repository / GitHub policy は `AGENTS.md` を正とする。

```markdown
# <タスクタイトル>

Status: planned | active | blocked
Priority: P0 | P1 | P2
Issue / PR: <該当があれば>
Requirement IDs: <無ければ none>

## 1. 背景
観測事実と推測を分ける。

## 2. 目的
完了時に成立する状態を書く。

## 3. Canonical references
- contract:
- status:
- roadmap:
- issue / requirement:

## 4. Entry conditions
着手前に必要な branch、依存実装、設計決定、検証済み条件。

## 5. Scope
- change:
- tests:
- non-goals:

## 6. Current production path
entrypoint → semantic interpretation → validation / binding → deterministic application → scheduler / dialogue → preview / approval / save のうち該当経路を具体化する。

## 7. Confirmed evidence
code、test、trace、browser、CI、real API から確認済みの事実。

## 8. Unknowns / competing hypotheses
未確認事項と、それを判定する証拠。

## 9. Ownership boundary
AI と deterministic application の責務を明示する。raw Japanese parser / regex / keyword を semantic authority として追加しない。

## 10. Change plan
owner layer で一般化して直す。症例専用 patch を避ける。

## 11. Acceptance criteria
入力、事前 state、期待 state / decision / output を検証可能に書く。

## 12. Verification
- targeted:
- full tests / typecheck / build:
- browser / E2E:
- real API / human review when relevant:
- exact diff / current HEAD:

## 13. Risks
concurrency、persistence、migration、security、privacy、cost、latency、compatibility。

## 14. Exit conditions
完了条件、docs sync、Issue / PR lifecycle、branch cleanupを明記する。

## 15. Durable checkpoint
active branch / PR、verified HEAD、completed work、remaining blocker、next action を必要に応じて更新する。
```

完了記録では古い実装手順を current instruction のように残さず、結果・検証・後続 owner だけを短く残す。
