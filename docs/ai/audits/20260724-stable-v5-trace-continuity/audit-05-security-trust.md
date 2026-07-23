# 監査5: security / trust boundary

Status: fixed
最終更新: 2026-07-24

## 発見

trace再開情報を保存する場合、別userまたは別conversationのcursorを再利用すると、監査ログの所有境界を破る。さらに保存payloadへ会話本文を複製すると、既存trace retentionとredaction境界の外側に内容データが増える。

## 修正

- cursor keyとpayloadをuser ID、conversation IDへ二重拘束する。
- cursor内sessionの`userId`と`logicalConversationId`が要求scopeと一致しない場合は全体を削除する。
- session status、timestamp、counter、request ID、schema versionをruntime validationする。
- raw user text、assistant text、semantic document、Fact Graph、preview本文をcursorへ保存しない。
- cursor sizeを64 KiB、recent request IDを128件、保存cursorを24件へ制限する。
- remote repositoryとWorkerのserver-issued structural ID、owner token、immutable entry契約は変更しない。

## 結論

今回の修正は既存のserver authorityを迂回しない。client cursorはserver IDそのものを新規決定せず、同じlocal idempotency keyを再提示するための継続metadataに限定する。
