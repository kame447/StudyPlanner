---
name: studyplanner-diagram-explainer
description: StudyPlanner の architecture、責務境界、data flow、state、sequence をユーザーへ視覚的に説明すると理解しやすくなる場面で使う。Diagram Design を使い、current code、tests、canonical docs を根拠に図を作る。
---

# StudyPlanner diagram explainer

## Purpose

Diagram Design は StudyPlanner runtime の機能ではなく、人間向けの説明を補助する開発ツールとして使う。

文章だけでは責務境界や処理順序を追いにくい場合に図を使う。短い質問や、文章だけで誤解なく説明できる内容では無理に図を作らない。

## Grounding order

図を作る前に、対象領域の現在の正本を確認する。

1. `AGENTS.md`
2. `PROJECT_MAP.md`
3. `docs/DOCUMENT_DICTIONARY.md`
4. owning domain の `README.md`
5. current canonical contract
6. current production code / tests
7. current Issue / active work record

`docs/archive/` は historical evidence であり、current behavior の正本として使わない。

## Choose the diagram by the question

- system boundary / responsibility boundary → architecture
- component 間の時系列 interaction → sequence
- lifecycle / transition → state machine
- pipeline / transformation → data flow or process
- dependency / ownership relationship → dependency graph

描画そのものは upstream の `diagram-design` skill を使う。

`diagram-design` skill が project-local に存在しない場合は、repository workspace で `bash scripts/install-diagram-design-skill.sh` を実行して導入する。

## Accuracy rules

- 図は説明用 artifact であり、canonical specification ではない。
- current code、tests、canonical docs と矛盾する内容を図にしない。
- 根拠のない node、edge、state、ownership を補完しない。
- 不明点や未確定事項は、確定済みの構造と区別する。
- source of truth が変わった場合、古い図を根拠に実装判断しない。

## Output rules

生成した HTML / SVG / PNG は、ユーザーが repository へ保存するよう明示しない限り `artifacts/diagrams/` 配下へ置く。`artifacts/` は通常の repository diff へ含めない。

図だけを返して説明を省略しない。図の読み方と、ユーザーが見るべき主要な流れを短い文章で補足する。
