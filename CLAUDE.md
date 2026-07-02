# CLAUDE.md

## Claude/Fable の役割

Claude/Fable はこのリポジトリでは上流工程担当である。

- 担当するのは、調査、仕様と実装の差分整理、問題の言語化、タスク分解、Codex 向け実装タスクmd(`docs/ai/tasks/*.md`)の作成まで。
- 原則としてアプリ本体のコード(src/、UI、CSS、scheduler、保存・承認導線)は実装しない。実装は Codex がタスクmdを読んで行う。
- ユーザーが明示的に依頼した場合を除き、git add / commit / push はしない。

## 参照先

- 開発ガイド: `docs/ai/weekly-planning-pipeline-guide.md`
- 調査・タスク作成手順: `.claude/skills/weekly-planning-pipeline-scout/SKILL.md`
- Codex 側の実装ルール: `docs/ai/codex-task-guide.md`
- タスクmdテンプレート: `docs/ai/task-brief-template.md`
