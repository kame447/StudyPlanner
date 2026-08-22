# Stable V5 verification・migration・default cutover

Status: closed / superseded
Closed: 2026-08-14

Stable V5は現在唯一のproduction週間計画runtimeで、legacy interpreter/parser/runtimeはPR #112以降productionから削除済み。PR #120で追加のreal API hardeningと構造監査を完了したため、この旧cutover taskはcurrent queueから外す。

旧保存previewのapproval compatibilityだけは別問題としてIssue #128で追跡する。
