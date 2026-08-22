# タスク md テンプレート

owning Issueだけではdurable technical detailが不足する場合に、責務domainの `work/` へ未完了taskを作るためのテンプレート。

- filename: `docs/domains/<responsibility>/work/YYYYMMDD-<slug>.md`
- active taskだけをdomain `work/`へ置く。
- 完了後は `docs/archive/work/closed/`、置換済みは `docs/archive/work/superseded/` へ移す。
- repository/GitHub policyは `AGENTS.md`、配置規則は `docs/DOCUMENT_DICTIONARY.md` を正とする。
- Issueに同じ情報が十分ある場合はtask MDを作らない。

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
着手前に必要なbranch、依存実装、設計決定、検証済み条件。

## 5. Scope
- change:
- tests:
- non-goals:

## 6. Current production path
該当するproduction pathを具体化する。owner layerとcaller/projection layerを分ける。

## 7. Confirmed evidence
code、test、trace、browser、CI、real API等から確認済みの事実。

## 8. Unknowns / competing hypotheses
未確認事項と、それを判定する証拠。

## 9. Ownership boundary
同じdecisionを複数layerが所有しないことを明示する。weekly-planningではraw Japanese parser/regex/keywordをsemantic authorityとして追加しない。

## 10. Change plan
owner layerで一般化して直す。症例専用patchを避ける。

## 11. Acceptance criteria
入力、事前state、期待state / decision / outputを検証可能に書く。

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
active branch / PR、verified HEAD、completed work、remaining blocker、next actionを必要に応じて更新する。
```

完了記録では古い実装手順をcurrent instructionのように残さず、結果・検証・後続ownerだけを短く残す。
