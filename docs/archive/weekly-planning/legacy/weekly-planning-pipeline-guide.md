# weeklyPlanning task and validation guide

Status: canonical / active
Updated: 2026-08-22

## Read order

1. `AGENTS.md`
2. [documentation index](weekly-planning-docs-index.md)
3. [current contract](weekly-planning-current-contract-v5.md)
4. [current status](weekly-planning-current-contract-status.md)
5. [roadmap](strategy/weekly-planning-roadmap.md)
6. [test philosophy](testing/weekly-planning-test-philosophy.md)
7. current Issue / task / PR

## Production boundary

```text
raw user utterance / conversation context
→ AI semantic interpretation
→ validated typed semantic delta
→ deterministic binding / Fact Graph lifecycle
→ deterministic proposal / readiness / question / scheduler decision
→ AI renderer
→ preview
→ deterministic approval / save / persistence
```

raw Japanese regex / keyword / dictionary / legacy parser を semantic authority として追加しない。provider failure から legacy parser へ fallback しない。renderer text から machine state を逆推定しない。

## Task lifecycle

- `docs/ai/tasks/` 直下には未完了 task のみ。
- completed → `tasks/closed/`
- superseded → `tasks/superseded/`
- 1 task は一つの主原因 / ownership boundary / acceptance unit を持つ。
- historical task の `Status: active` を current evidence にしない。

## Failure classification

1. production defect → owner layer を修正
2. stale / incorrect test contract → current contract に合わせて test を修正
3. harness / environment defect → harness を修正
4. external / transient failure → product defect と混同しない

Green 化だけを目的に regression を削除・弱体化しない。

## Verification

変更に応じて targeted tests → typecheck → full tests → build → diff review → browser/E2E → real API/human review を選ぶ。exact current HEAD の evidence を使う。

## GitHub lifecycle

Issue / branch / PR の作成・再利用・branch cleanup・history rewrite 等は `AGENTS.md` の GitHub / Git operation policy を正とする。この guide に別の Git 権限ルールを重複定義しない。
