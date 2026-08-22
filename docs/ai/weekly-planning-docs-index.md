# weeklyPlanning documentation index

Status: canonical / active
Updated: 2026-08-22

## Current source of truth

読む順序:

1. [current contract v5](weekly-planning-current-contract-v5.md)
2. [current contract status](weekly-planning-current-contract-status.md)
3. [main roadmap](strategy/weekly-planning-roadmap.md)
4. [human grounding policy](strategy/weekly-planning-human-grounding-dialogue-policy.md)
5. [adaptive memory policy](strategy/weekly-planning-adaptive-memory-learning-policy.md)
6. [test philosophy](testing/weekly-planning-test-philosophy.md)
7. [active task index](tasks/README.md)
8. current Issue / active task

Stable V5 の architecture、現在位置、実行順序が衝突する場合は contract → status → roadmap → current Issue / task の順で確認し、不整合そのものを修正する。

## Current execution

週間計画の次の feature/security priority は Issue #152 `Stable V5 adversarial conversation / prompt injection security evaluation`。

Issue #52 の weekly UI responsibility separation は未完。専用 AI 計画 surface は導入済みだが generic QuickEntry への weekly-planning plumbing が残る。

privacy / personalization / approval uniqueness / saved-preview migration / trace / client-first execution は各 open Issue と active task index の owner を維持する。

## Document placement

- `docs/ai/tasks/`: 未完了の実行 task と active task index のみ
- `docs/ai/tasks/closed/`: 完了済み task / handoff / checkpoint の短い completion record
- `docs/ai/tasks/superseded/`: 置換済み・延期済み task
- `docs/ai/strategy/`: 継続して有効な product / architecture policy と roadmap
- `docs/ai/testing/`: 継続して有効な test policy
- `docs/ai/audits/`: 検証 evidence。current execution queue ではない
- `docs/ai/closed/`: task 以外の historical records

root に置く Markdown は `README.md`、`AGENTS.md`、tool が自動認識する `CLAUDE.md` / `GEMINI.md`、repository navigation 用 `PROJECT_MAP.md` のように root placement に意味があるものだけとする。一時 brief / handoff / implementation memo を root に置かない。

## Maintenance rule

同じ原則を複数文書へ全文複製しない。contract は不変条件、status は現在位置、roadmap は実行順序、task は work unit、audit は evidence を所有する。

古い `Status: active`、branch 名、PR 番号だけを根拠に historical document を復活させない。完了済みの詳細は Git history / merged PR で追跡できるため、closed record は必要な結果だけを短く残す。
