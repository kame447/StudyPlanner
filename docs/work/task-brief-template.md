# タスク md テンプレート

owning Issue のみでは durable な技術的詳細が不足する場合に、担当ドメインの `work/` 配下に未完了タスクを作成するためのテンプレート。

- filename: `docs/domains/<responsibility>/work/YYYYMMDD-<slug>.md`
- active task だけを domain `work/` へ置く。
- 完了後は `docs/archive/work/closed/`、置換済みは `docs/archive/work/superseded/` へ移す。
- repository / GitHub policy は `AGENTS.md`、配置規則は `docs/DOCUMENT_DICTIONARY.md` を正とする。
- Issue に同じ情報が十分ある場合は task MD を作らない。

```markdown
# <タスクタイトル>

Status: planned | active | blocked
Priority: P0 | P1 | P2
Issue / PR: <該当があれば>
Requirement IDs: <無ければ none>
Owner domain: <responsibility>

## 1. 背景
観測事実と推測を分ける。

## 2. 目的
完了時に成立する状態を書く。

## 3. Canonical references
- domain index:
- contract/spec:
- roadmap:
- issue / requirement:

## 4. Entry conditions
着手前に必要な branch、依存実装、設計決定、検証済み条件。

## 5. Scope
- change:
- tests:
- non-goals:

## 6. Current production path
該当する production path を具体化する。owner layer と caller / projection layer を分ける。

## 7. Confirmed evidence
code、test、trace、browser、CI、real API 等から確認済みの事実。

## 8. Unknowns / competing hypotheses
未確認事項と、それを判定する証拠。

## 9. Ownership boundary
同じ decision を複数 layer が所有しないことを明示する。weekly-planning では raw Japanese parser / regex / keyword を semantic authority として追加しない。

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
完了条件、docs sync、Issue / PR lifecycle、branch cleanup を明記する。

## 15. Durable checkpoint
active branch / PR、verified HEAD、completed work、remaining blocker、next action を必要に応じて更新する。
```

完了記録をアーカイブする際は、古い実装手順を現在の指示と誤認させないよう、結果・検証・後続の owner のみを簡潔に残す。
