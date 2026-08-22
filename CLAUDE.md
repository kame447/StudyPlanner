# CLAUDE.md

このリポジトリでは、repository-level の正仕様を `AGENTS.md` と current canonical docs に集約する。

## Read order

1. `AGENTS.md`
2. `docs/ai/weekly-planning-docs-index.md`
3. `docs/ai/weekly-planning-current-contract-v5.md`
4. `docs/ai/weekly-planning-current-contract-status.md`
5. `docs/ai/strategy/weekly-planning-roadmap.md`
6. 対象 Issue / task / PR

## Rules

- agent 名ごとの古い役割分担や historical task を current instruction として使わない。
- `docs/ai/tasks/` 直下は未完了 task のみとする。
- 完了済み task は `docs/ai/tasks/closed/`、superseded は `docs/ai/tasks/superseded/` を参照する。
- Stable V5 の semantic ownership、Git/GitHub 操作、検証、完了条件は `AGENTS.md` を優先する。
- 「Claude は調査だけ、Codex は実装だけ」の固定分担は current policy ではない。ユーザー依頼と利用可能な tool に従う。
