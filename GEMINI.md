# GEMINI.md

このファイルは Gemini 系 agent の repository entry point である。個別の旧リファクタ指示は保持しない。

## Read order

1. `AGENTS.md`
2. `docs/ai/weekly-planning-docs-index.md`
3. `docs/ai/weekly-planning-current-contract-v5.md`
4. `docs/ai/weekly-planning-current-contract-status.md`
5. `docs/ai/strategy/weekly-planning-roadmap.md`
6. 対象 Issue / task / PR

Stable V5 では raw Japanese を regex / keyword / dictionary / legacy parser で semantic truth として再解釈しない。古い normalize → tokenize → parser → AST → IR 前提の指示や、historical task の `Status: active` を current instruction として復活させない。

実装・GitHub 操作・検証は `AGENTS.md` の current policy に従う。
