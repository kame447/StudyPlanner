---
name: weekly-planning-pipeline-scout
description: StudyPlanner の weeklyPlanning 実装を current canonical docs と照合し、未完了 task を調査・整理する。
---

# weekly-planning-pipeline-scout

## Read order

1. `AGENTS.md`
2. `docs/ai/weekly-planning-docs-index.md`
3. `docs/ai/weekly-planning-current-contract-v5.md`
4. `docs/ai/weekly-planning-current-contract-status.md`
5. `docs/ai/strategy/weekly-planning-roadmap.md`
6. `docs/ai/testing/weekly-planning-test-philosophy.md`
7. 対象の Issue / `docs/ai/tasks/*.md`

V4 architecture、legacy runtime、closed / superseded task、古い branch / PR 前提を current instruction として使わない。

## Investigation order

```text
entrypoint
→ AI semantic interpretation
→ schema / evidence / reference validation
→ formal binding / Fact Graph lifecycle
→ deterministic readiness / dialogue decision
→ scheduler / preview
→ approval / save / persistence
```

raw Japanese の regex / keyword / dictionary / legacy parser を semantic authority として復活させない。

## Task policy

- `docs/ai/tasks/` 直下には未完了 task だけを置く。
- 完了 task は `docs/ai/tasks/closed/`、superseded は `docs/ai/tasks/superseded/` へ移す。
- historical issue を再利用する場合は current main と canonical contract を再調査する。
- Git/GitHub 操作と verification は `AGENTS.md` に従う。

## Report

1. 調査範囲
2. current production path
3. canonical docs との差分
4. 更新した task / Issue / PR
5. 未完了事項
6. verification evidence
