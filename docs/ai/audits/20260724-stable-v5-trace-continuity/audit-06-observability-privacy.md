# 監査6: observability / privacy

Status: fixed with additional findings recorded
最終更新: 2026-07-24
Reviewed main baseline: `a669b166db30fa3f355371c089062eb5cf4e3987`

## 発見

同一conversationが複数sessionへ分裂すると、admin export、evaluation fixture、roleplay candidateがturn単位に分断される。その結果、multi-turnの意味保持、質問への短答、訂正、preview authorizationを一つの系列として評価できない。

今回の二つのexportは同じ`logicalConversationId`を持ち、後半snapshotの`sourceTurns`には前半発話が存在する。それにもかかわらず、local session ID、server session ID、sequence、turn index、entry countはそれぞれ初期値から始まっていた。

## 修正

- metadata-only cursorでlocal session ID、entry sequence、turn index、request dedupe setを復元する。
- server-issued handle mappingでremote repository再生成後も同じcanonical sessionへappendする。
- 30分を超えるidleによるsession分割を廃止する。
- cursorとhandle mappingは内容データを保存せず、既存trace repositoryだけがredaction済みturn本文を保持する。
- 同一conversationの二turn、1時間idle、clear後reload、remote repository reloadをintegration/unit testへ追加する。
- write failure後のretryでsequence gapが発生しない回帰を追加する。

過去に既に分割されたsessionをlogical conversation IDだけで自動mergeしない。owner、generation、reset境界を誤認する危険があるため、historical exportはそのまま保持する。

## その他の所見

`responseSource`はStable V5でも`system`として記録される。これはdeterministic rendererを表すが、発話理解がAI semantic normalizerを経由した事実を表せない。「assistant文面の生成主体」と「意味解釈主体」を一つのfieldで表す設計が不十分である。

現行fieldの意味をrenderer sourceへ限定し、semantic interpretation sourceは別fieldまたはinternal event payloadで明示する必要がある。このfield再設計は既存export schema、admin viewer、evaluation fixtureへ影響するため、別taskとする。

また、turn commit直後にbrowserを閉じると最終trace appendが未完了のまま失われ得る。会話処理をtrace成功へ同期させず、durable delivery queueを設ける課題として分離する。
