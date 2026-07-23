# 監査6: observability / privacy

Status: fixed with additional findings recorded
最終更新: 2026-07-24

## 発見

同一conversationが複数sessionへ分裂すると、admin export、evaluation fixture、roleplay candidateがturn単位に分断される。その結果、multi-turnの意味保持、質問への短答、訂正、preview authorizationを一つの系列として評価できない。

今回の二つのexportは同じ`logicalConversationId`を持ち、後半snapshotの`sourceTurns`には前半発話が存在する。それにもかかわらず、session ID、sequence、turn index、entry countはそれぞれ初期値から始まっていた。

## 修正

- trace cursorでsession ID、entry sequence、turn index、request dedupe setを復元する。
- cursorは内容データを保存せず、既存のtrace repositoryだけがturn本文を保持する。
- 同一conversationの二turnを一つのtrace sessionへ結合するintegration testを追加する。
- write failure後のretryでsequence gapが発生しない回帰を追加する。

## その他の所見

`responseSource`はStable V5でも常に`system`として記録される。実際にはAI semantic normalizerを経由しているため、「assistant文面の生成主体」と「意味解釈主体」を一つのfieldで表せない。現行fieldの意味はrenderer sourceへ限定し、semantic interpretation sourceはinternal event payloadで明示する必要がある。

このfield再設計は既存export schemaへ影響するため、本修正では変更せず別taskとする。
