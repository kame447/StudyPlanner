# 週間計画の対話処理経路に関する課題分割

Status: open
Updated: 2026-07-15
PR: #3

## 目的

PR #3で扱っている問題を、原因と完了条件が独立する単位へ分割する。挙動として解決済みの項目はclosedとし、残作業だけをopenで管理する。

## Closed

### AI interpreter経路のdeterministic baseline

`20260715-weekly-planning-ai-deterministic-baseline.md`

「来週」などrules parserで取得できる情報をAI経路でも保持し、provider失敗時だけlegacy fallbackへ切り替える問題は完了済み。

### dialogue actionの優先順位とtopic別fallback

`20260715-weekly-planning-dialogue-action-priority-and-fallback.md`

計画期間や学習内容がaction上限から脱落する問題と、すべての`show_options`が利用可能時間の質問へ誤描画される問題は完了済み。

### 聞き返し対象と直前質問コンテキスト

`20260715-weekly-planning-clarification-context-generalization.md`

説明対象と回答例の不一致、missing以外の質問に対する聞き返し欠落、経路間のclarification decision不一致は完了済み。

### 実装構造の整理

`20260715-weekly-planning-dialogue-path-implementation-cleanup.md`

core複製とwrapper構成を既存pipelineへ直接統合し、一時helper、trigger、cleanup scriptを削除した。

## Open

### PRの最終検証と終了処理

`20260715-weekly-planning-dialogue-path-pr-finalization.md`

構造整理後に全テスト、build、diff check、PR差分監査を行い、baseをmainへ戻してPRを最終状態にする。

## Trackerをclosedにする条件

- open taskがすべてclosedになっている
- PRのbaseが`main`である
- 一時workflow、script、trigger、core複製がPR差分に残っていない
- 週間計画全テスト、build、diff checkが成功している
- PR本文が最終差分と一致している
