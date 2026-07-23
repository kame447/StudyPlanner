# Stable V5 trace continuity 七視点監査 総括

Status: implementation complete / automated verification pending
最終更新: 2026-07-24
Reviewed main baseline: `a669b166db30fa3f355371c089062eb5cf4e3987`
Draft PR: #83

## 判定

今回の実トレースで確認された「一つの会話がturnごとに別trace sessionへ分裂する」問題は、一覧UIのgrouping不足ではなく、conversation復元後にcontroller、local trace cursor、remote server handleのidentityが別々に初期化される実装不具合である。

修正後の不変条件は次とする。

```text
同一owner + 同一logical conversation
→ idle時間に関係なく同一local trace session ID
→ request/turn IDはmessage列またはPlanningState revisionの単調下限より後
→ entry sequenceとturn indexは保存済みtrace列の続き
→ remote repository再生成後も同一server-issued handle
→ append失敗はcounterとrequest IDを消費しない
```

新しいconversation、明示的なsession reset、owner変更、week scope変更だけが新しいtrace identityを作る。30分idleをconversation終了条件として使用しない。保存cursor自体の保持上限は90日であり、過去に分割済みのhistorical logsは誤結合を避けるため自動mergeしない。

## BLOCKER

解消済み。

- 同じconversationでページ再読込またはruntime再生成後にtrace sessionが分裂する。
- 30分idle後に同じconversationを別physical sessionへ分割する。
- remote repository再生成または30日secret epoch境界でserver sessionを再発行し得る。
- 復元後に`request:1`、`turn:1`、message IDを再発行する。
- `clear_conversation`後の再読込でmessagesが空になり、過去のrequest IDを再利用する。
- append失敗時にsequenceだけ進み、retry後のentry列が欠損する。

## MAJOR

本修正の範囲で解消済み。

- 既存testがconversation/Graphだけを確認し、controller、trace cursor、remote handleまで跨いでいない。
- Stable V5 persistenceを未実装とするcanonical MDがmainの実装と矛盾している。
- 一時的network failureでserver handleを捨てると、応答喪失時に別sessionへ移る可能性がある。

別taskへ分離。

- 同じconversationを複数tabで同時操作する場合のbrowser-wide sequence reservation。
- `responseSource`とsemantic interpretation sourceの概念分離。
- accepted factをassistant acknowledgementへ反映するdialogue grounding回帰。
- abrupt page close時の最終trace write durability。

## 七視点の結論

architectureではlogical conversationをlocal physical sessionとremote handleの継続scopeに統一した。schema/runtime contractではcursorとstored handleをclosed validationする。state atomicityではworking copyをappend成功後だけcommitする。dialogue/UXではclear後のID再利用をPlanningState revisionで防いだ。securityではowner-scoped local metadataだけを保持し、server認証を正本とする。observabilityでは一つのconversationを一つのentry列として追跡可能にした。test/merge hygieneではreload、idle、clear、repository recreation、stale handle、transient failureを回帰testへ追加した。

## 変更範囲

```text
controller request sequence recovery
PlanningState revisionによる永続的なsequence下限
metadata-only trace cursor
transactional trace sequence allocation
idle timeout split廃止
server-issued handle persistence
structural rejection時だけhandle再発行
transient append failureのsame-payload retry
runtime-memory-loss / idle / clear / remote reload regression tests
controller / reducer / trace integration test
current contract、runtime contract、status、roadmap、docs index更新
```

## 最終gate

```text
focused tests
→ full test
→ typecheck
→ production build
→ branch previewでreload・1時間idle・clear後再送を実操作
→ admin exportが一つのsessionになることを確認
→ unresolved review thread 0
→ review
```

GitHub Actionsはjobを生成したがstep 0件・logsなしでrunner起動前に失敗している。これはcode test failureではないが、focused/full/typecheck/buildの成功証跡でもない。このgateの実行結果を取得するまでは、PR #83をDraft・merge不可とする。
