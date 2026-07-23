# 監査1: architecture

Status: fixed with one residual follow-up
最終更新: 2026-07-24

## 対象

Stable V5の会話復元、controller、trace runtime、remote trace repository、Worker APIの境界を監査した。

## 発見

同じ`logicalConversationId`を持つ対話状態は復元されていたが、trace runtimeはmodule-localな`activeSessions`だけを正本としていた。ページ再読込またはmodule再生成後は、同じ会話でも新しいlocal trace session IDを発行していた。

controllerの`requestSequence`もmemory-onlyであり、同じconversation IDを復元しても`request:1`と`turn:1`を再発行していた。さらに、履歴を消去する`clear_conversation`はconversation IDを維持したままmessagesを空にするため、message列だけを復元根拠にすると再読込後にrequest IDを再利用した。

remote repositoryもserver-issued handleをrepository instance内だけに保持していた。実serverのcanonical IDには30日secret epochが含まれるため、repository再生成後に`startSession`を再実行する設計ではepoch境界で同じconversationが別server sessionへ分裂し得た。

## 修正

- controllerは現在の`PlanningState.messages`と永続化済み`revision`から単調なsequence下限を復元し、その次の番号を発行する。
- trace runtimeはuser・conversationに拘束したmetadata-only cursorをlocalStorageへ保存し、idle時間に関係なく同じtrace session、entry sequence、turn indexへ復帰させる。
- 30分idle timeoutをphysical session終了条件から除外する。
- remote repositoryはserver-issued handleをowner・local sessionに拘束して保存し、repository再生成後も同じhandleへappendする。
- serverがstructural rejectionを明示した場合だけhandleを再発行し、一時的network failureでは同じcanonical payloadを再送する。
- persisted cursorは最大24件へ制限し、90日を超えるcursorを削除する。

## 残課題

複数tabが同じconversationを同時に進める場合、browser-wideにsequenceを原子的に予約する契約は未実装である。現行UIの単一tab運用では今回の不具合を解消するが、cross-tab同時実行は別taskで扱う。
