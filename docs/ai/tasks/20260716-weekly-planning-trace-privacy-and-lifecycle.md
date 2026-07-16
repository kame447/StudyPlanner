# 週間計画traceのprivacyとlifecycleを確定する

Status: blocked by product decision
Priority: P1
Requirement IDs: P7-TRACE-001

## 1. 背景

conversation trace基盤は実装済みだが、productionでの有効化、発話全文保存、opt-in、retention、account deletion、admin accessのproduct contractが確定していない。dialogue architectureの無断永続化禁止と、trace architectureのcontent保存契約が競合している。

## 2. 目的

traceの利用目的、保存範囲、同意、保持、削除、閲覧権限を一つのprivacy contractとして確定し、実装・運用・ユーザー説明を同期する。

## 3. Entry conditions

次をproduct decisionとして確定する。

- productionでtraceを有効にするか
- opt-inまたはopt-outのどちらを採用するか
- metadata-onlyを既定にするか
- user/assistant turn本文を保存するか
- 保存前redactionの対象
- retention期間
- account deletion時のcascade
- admin viewerとexportの権限

## 4. 対象責務

- feature flagと既定値
- consent state
- raw contentとmetadataの分離
- redactionと匿名化
- Firestore TTL policy
- account deletion
- admin read、export、evaluation fixture化
- privacy noticeと削除手順

## 5. 触らない範囲

- planning結果の計算
- scheduler
- dialogue action選択
- client eventを監査証跡として利用すること

## 6. 受け入れ条件

- dialogue architectureとtrace architectureに同じprivacy boundaryが記載される。
- production既定値が明示される。
- content保存とmetadata保存を別々に制御できる。
- TTL policyとaccount deletionの運用手順が存在する。
- 非管理者のreadを拒否し、admin accessを監査可能にする。
- export時に再redactionし、fixtureへの自動投入を禁止する。
- privacy decision未完了の間はproduction enablementを完了扱いにしない。

## 7. Exit conditions

- product spec、dialogue architecture、trace architecture、Firestore運用文書、UI説明を同期する。
- 実装変更が必要な場合はprivacy decision確定後に別実装commitで行う。
