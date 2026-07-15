# dialogue actionの優先順位とtopic別fallback

Status: closed
Closed: 2026-07-15
Parent: `20260715-weekly-planning-dialogue-path-issue-breakdown.md`

## 対象問題

behavior-aware pipelineのaction統合は、追加のfeasibility actionを先頭へ置いた後に3件へ切り詰めていた。このため、計画期間や学習内容など、予定作成の基礎情報を確認するactionが脱落する場合があった。

また、fallback rendererが`topicId`を参照せず、`show_options`を一律に利用可能時間の質問として描画していた。そのためplanning-rangeのactionが「使える時間は」と誤描画されていた。

## 実施内容

`mergeActions`へ明示的な優先順位を導入し、計画期間、学習内容、preview生成、調整提案などをaction上限内に保持するようにした。

計画期間や学習内容が未確認の段階では、汎用的な`feasibility_basis`が基礎質問へ割り込まないようにした。

fallback rendererは`topicId`別に分岐し、少なくともplanning-range、task-identity、availability-basisを異なる質問として描画するようにした。

## 完了条件

- [x] planning-rangeとtask-identityがaction上限から脱落しない
- [x] 基礎情報が不足する段階で汎用feasibility actionが割り込まない
- [x] planning-rangeが利用可能時間の質問へ誤描画されない
- [x] task-identityが具体的な学習内容と量を尋ねる
- [x] availability-basisだけが時間割・既存予定・空き時間を尋ねる
- [x] 既存のroleplay/actionテストと追加回帰テストが通る

## 対象外

「どういうこと？」などの聞き返し対象解決と、実装ファイルの構造整理は別taskで扱う。
