# 週間計画対話へ明示的修復とやり過ごしを導入する

Status: closed
Created: 2026-07-16
Closed: 2026-07-16

## 目的

不確実な解釈をすべて質問へ変換せず、予定を止める不確実性だけを明示的に修復し、それ以外は後続確認へ延期する。受理済み事項は、現在stateと直近user turnに根拠を持つ短い反復で確認する。

## 実装

- `weeklyPlanningDialogueRepairPolicy.ts`を追加
- policyを`explicit_repair`、`pass_over`、`continue`へ有限分類
- clarification requestは常に明示的修復
- preview blocking dimensionは明示的修復
- safe defaultまたは有限optionがある場合は自由質問よりproposal confirmationを優先
- non-blocking uncertaintyはそのturnで質問せずdeferred topicとしてやり過ごす
- 明示的修復は一度に一topicへ限定
- latest user turnとaccepted stateの両方に根拠があるfactだけをdeterministic acknowledgementへ変換
- AIが作った未根拠acknowledgementは表示しない
- fixed event等の既存grounded renderer境界を維持

## 対話上の意味

- 明示的修復: 解釈を誤ると計画期間、task、workload、availability等が成立しない場合に、対象を明示して確認する。
- やり過ごし: 現時点の計画を止めず、後で訂正可能な不確実性を質問せず保持する。
- acknowledgement: 単なる相槌ではなく、何を受理したかを短く反復して共有成立を表示する。

## 検証

- policy unit tests: 5 passed
- dialogue planner tests: 8 passed
- full test suite: 984 passed、13 skipped、5 todo
- production build: passed
- 一時診断workflowと旧自動書換えworkflow/scriptは削除済み

## 補足

週の始まりを月曜または日曜として初回だけ確認し、以後profile設定を参照する機能は本変更には含めない。別のuser preference実装として扱う。
