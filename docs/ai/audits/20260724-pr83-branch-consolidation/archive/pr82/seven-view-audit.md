# 週間計画trace会話継続性 七視点監査

Status: implementation complete / automated verification pending
Updated: 2026-07-24
Reviewed main baseline: `a669b166db30fa3f355371c089062eb5cf4e3987`
Change branch: `fix/weekly-planning-trace-conversation-continuity`
Draft PR: #82

## 監査対象

Stable V5のlogical conversationが継続しているにもかかわらず、管理画面上で複数のphysical trace sessionへ分割される問題を対象とする。対象境界は、Stable V5 runtime、trace continuity、remote repository、server-issued handle、回帰テスト、canonical documentationである。

## 1. アーキテクチャとidentity境界

初回判定はBLOCKERである。

PlanningStateとFact Graphは`conversationId`を復元する一方、trace runtimeはmodule memory内でrandom physical session IDを生成していた。したがって、logical conversationのownerとphysical trace sessionのownerが別々のlifecycleを持ち、ページ再読込、module再初期化、deploy後の再開で同じ会話が別ログになった。また、30分idle timeoutがlogical conversationの継続状態と無関係にsessionを分割していた。

修正後は、physical trace continuityを`userId + conversationId`へ拘束し、local trace session IDをconversationから安定生成する。新しいconversationまたは明示resetだけが別sessionを生成し、無操作時間はsession分割条件にしない。

判定は修正済みである。

## 2. 状態遷移、sequence、idempotency

初回判定はMAJORである。

`nextSequence`、`nextTurnIndex`、処理済み`requestId`がmemory onlyであり、runtime再生成後に0へ戻った。physical session IDだけを再利用してもentry ID衝突、順序逆転、turn index重複が起きるため、会話結合性はID修正だけでは成立しない。

修正では、session metadata、次sequence、次turn index、直近200件のrequest IDをclosed envelopeへ保存する。entry生成後かつrepository append前に予約済みcounterを保存し、再読込がappendと競合しても同じsequenceを再利用しない。repository write failure後もrequest IDを即時解放せず、同一requestの二重記録より欠損を優先するat-most-once境界とした。

残余リスクとして、200件より古いrequest IDのclient-side dedupeは保持しない。通常turnは新しいrequest IDを発行し、server entryはimmutableであるため、現時点では許容する。

判定は修正済みである。

## 3. persistence、reload、破損データ

初回判定はMAJORである。

Stable V5の会話とFact Graph persistenceは追加済みだったが、trace continuityは保存対象に含まれていなかった。既存のsession persistence testはPlanningStateとGraphの同時復元だけを確認し、trace session continuityを確認していなかった。

修正では、trace continuityをPlanningStateとは別のlocal envelopeとして保存する。version、owner、conversation、session shape、timestamp、counterを検証し、owner不一致、conversation不一致、壊れたJSON、不正なstructural valueを削除して新規生成へ戻す。`pendingTurn`等のapplication stateは保存しない既存境界を維持する。

過去に既に分割されたphysical logsを自動結合するmigrationは行わない。今回の変更適用後に作成または継続するturnから一貫性を保証する。

判定は修正済みである。

## 4. client/server repository境界

初回判定はMAJORである。

remote repositoryはserver-issued session handleをrepository instance内のPromise mapだけに保持していた。ページ再読込でrepositoryが再生成されると`startSession`を再実行する。通常は同一epoch内のHMAC idempotencyで同じhandleへ収束するが、secret epoch境界では別handleを発行し得るため、client continuityだけでは長期会話の結合性が不足した。

修正では、server-issued handleを`userId + localSessionId`で閉じたlocal mappingへ保存し、repository再生成後も同じhandleへappendする。stored handleはserver session IDとserver conversation IDの形式を検証する。serverがhandleを拒否した場合はmappingを破棄し、session startとappendを一度だけ再試行する。

追加監査で、任意のnetwork failureでもhandleを破棄すると、応答喪失とepoch境界が重なった場合に別handleへ移る可能性を確認した。最終修正では、handle invalidationをserverが明示するstructural conflictへ限定し、それ以外は同一canonical payloadを再送することを完了条件とする。

判定は追加修正中である。

## 5. セキュリティ、privacy、trust boundary

初回判定はMINORである。

server-issued handleはaccount identityではなくHMAC由来のstructural IDであるため、local continuityへ保存してもraw UID、email、本文を追加保持しない。remote append前にはclient structural IDをserver canonical IDへ置換する既存境界を維持する。

continuity keyはclient-side owner scopeを分離するためにowner IDを使用するが、trace payloadまたはserver documentへは送らない。保存値はclosed validationを通し、stored handleを権威的owner証明として扱わない。server append時の認証とownership検証が正本である。

判定は採用可である。

## 6. 可観測性と管理画面UX

初回判定はBLOCKERである。

管理画面ではphysical session document単位でログを表示するため、同じlogical conversationが複数documentへ分かれると、発話の前提、質問の理由、Fact Graph revisionの流れを一画面で追えない。これは表示上の問題ではなく、記録生成時のidentity bugである。

修正後は同じconversationのentryが同じphysical session、連続sequence、連続turn indexへ追加される。新conversationは別sessionとして表示する。既存分割ログはhistorical recordとして残し、誤って別会話へmergeしない。

追加で、trace writeはturn commit後のbest-effort side effectであり、タブを即時終了した場合の最終turn欠損は残る。会話分割とは別問題として、flushまたはserver-side queueを後続検討する。

判定は主問題を修正済み、最終turn durabilityは残余課題である。

## 7. テスト、変更範囲、merge hygiene

初回判定はBLOCKERである。

既存testは単一runtime内の記録、同一request IDのdedupe、error redactionだけであり、次を確認していなかった。

```text
runtime memory loss後の同一conversation
30分超の無操作後の同一conversation
別conversationへの切替
remote repository再生成
stored server handleの再利用
stale handle recovery
sequenceとturn indexの連続性
```

上記をfocused testへ追加した。さらに、focused test、full test suite、TypeScript、production build、`git diff --check`を一時verification workflowで実行する。workflow成功後に結果を本書へ追記し、一時workflowを削除する。PR #82はそれまでDraftを維持する。

判定はautomated verification待ちである。

## 発見事項の最終分類

```text
BLOCKER  physical trace sessionがlogical conversationと独立して再生成される
BLOCKER  reload/idle continuityの結合テストが存在しない
MAJOR    sequence、turnIndex、request dedupeがmemory only
MAJOR    remote server handleがrepository instance memory only
MAJOR    generic append failure時のhandle invalidation条件が広すぎる
MINOR    既存canonical MDがPR #77 merge前のGraph memory-only記述のまま
MINOR    abrupt page close時の最終trace durabilityがbest effort
```

## merge条件

```text
handle invalidation条件をstructural rejectionへ限定
focused trace tests success
full test suite success
TypeScript success
production build success
git diff --check success
canonical MD更新
一時workflow削除
unresolved review thread 0
Draft維持または明示的な解除判断
```
