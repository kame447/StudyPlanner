# GEMINI.md

このファイルは Gemini 系 agent の repository entry point である。個別の旧リファクタ指示は保持しない。Markdown の配置規則は `docs/DOCUMENT_DICTIONARY.md` を正とする。

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

Stable V5 では raw Japanese を regex / keyword / dictionary / legacy parser で semantic truth として再解釈しない。古い normalize → tokenize → parser → AST → IR 前提の指示や、`docs/archive/` 内 historical task の `Status: active` を current instruction として復活させない。

`docs/ai/` や `docs/testing/` のような audience/tool 基準の canonical directory を再作成しない。実装・GitHub 操作・検証は `AGENTS.md` の current policy に従う。
