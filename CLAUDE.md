# CLAUDE.md

このリポジトリでは、repository-level の正仕様を `AGENTS.md` と responsibility-owned canonical docs に集約する。Markdown の配置規則は `docs/DOCUMENT_DICTIONARY.md` を正とする。

## Read order

1. `AGENTS.md`
2. `PROJECT_MAP.md`
3. `docs/README.md`
4. 対象 responsibility の domain README
5. canonical contract / current Issue / active work record

週間計画の場合:

1. `docs/domains/weekly-planning/README.md`
2. `docs/domains/weekly-planning/architecture/current-contract-v5.md`
3. `docs/domains/weekly-planning/quality/test-philosophy.md`
4. `docs/domains/weekly-planning/roadmap/current.md`
5. 対象 Issue / `docs/domains/weekly-planning/work/README.md`

## Rules

- agent 名ごとの古い役割分担や historical task を current instruction として使わない。
- audience/tool 名で `docs/ai/`、`docs/testing/` 等の新しい canonical bucket を作らない。
- active task は owning domain の `work/` または owning Issue に置く。
- 完了済み/superseded task と audit は `docs/archive/` の historical evidence として扱う。
- Stable V5 の semantic ownership、Git/GitHub 操作、検証、完了条件は `AGENTS.md` と weekly-planning current contract を優先する。
- 「Claude は調査だけ、Codex は実装だけ」の固定分担は current policy ではない。ユーザー依頼と利用可能な tool に従う。
