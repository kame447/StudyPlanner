# 監査1: architecture

Status: fixed with one residual follow-up
最終更新: 2026-07-24

## 対象

Stable V5の会話復元、controller、trace runtime、remote trace repository、Worker APIの境界を監査した。

## 発見

同じ`logicalConversationId`を持つ対話状態は復元されていたが、trace runtimeはmodule-localな`activeSessions`だけを正本としていた。ページ再読込またはmodule再生成後は、同じ会話でも新しいlocal trace session IDを発行していた。

同時にcontrollerの`requestSequence`もmemory-onlyであり、同じconversation IDを復元しても`request:1`と`turn:1`を再発行していた。つまり、conversation persistence、controller identity、trace persistenceの三境界が独立していた。

## 修正

- controllerは現在の`PlanningState.messages`から同一conversationの最大turn番号を復元し、その次の番号を発行する。
- trace runtimeはuser・conversationに拘束したmetadata-only cursorをlocalStorageへ保存し、30分以内の継続会話を同じtrace session、entry sequence、turn indexへ復帰させる。
- remote repositoryのserver-issued ID契約は変更せず、同じlocal idempotency keyを再利用して同じserver sessionへ接続する。
- persisted cursorは最大24件へ制限し、90日を超えるcursorを削除する。

## 残課題

複数tabが同じconversationを同時に進める場合、browser間でsequenceを原子的に予約する契約は未実装である。現行UIの単一tab運用では今回の不具合を解消するが、cross-tab同時実行は別taskで扱う。
