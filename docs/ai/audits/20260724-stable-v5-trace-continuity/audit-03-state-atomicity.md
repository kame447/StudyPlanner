# 監査3: state atomicity

Status: fixed
最終更新: 2026-07-24

## 発見

旧trace runtimeはrepository書込み前に`nextSequence`、`nextTurnIndex`、`turnCount`、`requestIds`を直接進めていた。appendが失敗した場合はrequest IDだけを削除し、sequenceとturn countを巻き戻さなかった。

このため同じrequestを再試行すると、保存済みentryが存在しないのにsequenceが途中から始まり、sessionの`entryCount`と実entry列が一致しない可能性があった。

また複数のrecord呼出しはappendだけをqueueしており、entry採番自体はqueue外で行っていた。非同期呼出しが重なると、write順と採番時点を一つのtransactionとして扱えていなかった。

## 修正

- request dedupe、working copy生成、entry採番、append、cursor保存をsession単位queue内へ移動した。
- session metadataとcounterはworking copyで更新し、repository append成功後だけactive stateへcommitする。
- append失敗時はactive counterとrequest ID setを変更しない。同じrequestを再試行するとsequence 0から正しく再生成できる。
- persisted cursorもappend成功後だけ更新する。

## 不変条件

```text
session.entryCount = nextSequence = 保存済みentry数
session.turnCount = nextTurnIndex = 保存済みturn数
同一request IDは成功後に一度だけ記録
失敗したappendはcounterを消費しない
```
