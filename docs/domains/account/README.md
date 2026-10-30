# Account

Status: canonical responsibility entry point

このdomainは退会と個人データ削除の責務を所有します。アカウント削除は、利用者の確認と再認証、サーバー側の削除ジョブ、端末内データの消去を一つの手続きとして扱います。

- [削除対象・保持例外・監査・運用手順](policies/account-deletion-and-retention.md)
- Issue #917: 実装・検証・本番反映の進捗と完了証拠。文書の存在は本番反映の完了を意味しません。
- [週間計画traceの契約](../weekly-planning/architecture/weekly-planning-conversation-trace.md) / [Issue #45のprivacy・lifecycle記録](../weekly-planning/work/20260731-trace-privacy-and-lifecycle.md): traceの保持・マスキング・アクセス監査の所有者。

認証・同期の実装は既存のrepository / service境界、週間計画の意味解釈はweekly-planning、利用状況の集計はproduct-observabilityが引き続き所有します。このdomainは、それらを退会時にどう削除し、何を残すかを定めます。
