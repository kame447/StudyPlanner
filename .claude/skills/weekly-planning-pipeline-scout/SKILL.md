---
name: weekly-planning-pipeline-scout
description: StudyPlanner の weeklyPlanning 実装を current canonical docs と照合し、未完了 task を調査・整理する。
---

# weekly-planning-pipeline-scout

## Read order

1. `AGENTS.md`
2. `PROJECT_MAP.md`
3. `docs/DOCUMENT_DICTIONARY.md`
4. `docs/domains/weekly-planning/README.md`
5. `docs/domains/weekly-planning/architecture/current-contract-v5.md`
6. `docs/domains/weekly-planning/quality/test-philosophy.md`
7. `docs/domains/weekly-planning/roadmap/current.md`
8. 対象 Issue / `docs/domains/weekly-planning/work/*.md`

`docs/archive/` 内の V4 architecture、legacy runtime、closed/superseded task、古い branch/PR 前提を current instruction として使わない。

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

## Documentation / task policy

- 文書配置は `docs/DOCUMENT_DICTIONARY.md` に従う。
- weekly-planning のcurrent docsは `docs/domains/weekly-planning/` に置く。
- 未完了taskは owning Issue または `docs/domains/weekly-planning/work/` に置く。
- 完了/superseded/auditは `docs/archive/` に移し、current queueへ戻さない。
- historical issue を再利用する場合は current main と canonical contract を再調査する。
- Git/GitHub 操作と verification は `AGENTS.md` に従う。

## Report

1. 調査範囲
2. current production path
3. canonical docs との差分
4. 更新した task / Issue / PR
5. 未完了事項
6. verification evidence
