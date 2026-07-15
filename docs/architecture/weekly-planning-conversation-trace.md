# Weekly Planning Conversation Trace Architecture

## Responsibility

週間計画conversation traceは、計画処理の結果を決定するdomain stateではない。実利用時に何が入力され、どの解釈と状態遷移を経て、何を表示し、preview／approvalがどう処理されたかを後から確認するためのdiagnostic journalである。

trace書き込みはbest effortであり、失敗してもplanning pipeline、preview生成、approval結果を変更しない。

## Storage model

Cloud Firestore上では次の2 collectionを使用する。

```text
weekly_planning_trace_sessions
weekly_planning_trace_entries
```

session documentは一覧query向けsummaryである。entry documentはappend-only journalであり、次のdiscriminated unionを保存する。

```text
turn
internal_event
state_snapshot
```

turn、internal event、snapshotのpayload契約は分離する。ただし保存先を単一journalへまとめ、session内の`sequence`で時系列を再構成する。

subcollectionを採用しない理由は、session削除時に子documentが自動削除されない構造を避け、retentionとaccount deletionの対象collectionを明示するためである。

## Identity and ordering

```text
logicalConversationId
trace session id
requestId
stateRevision
sequence
turnIndex
```

`logicalConversationId`はplanning runtimeの会話識別子である。呼出側が明示しない場合は初回turnで生成し、返却された`PlanningIntakeState`のobject identityと対応付けて次turnへ継続する。同じ初期requestが短時間にretryされた場合も同じconversation identityを再利用する。trace session idは保存上の一意IDであり、idle timeout後の再開時には新しく生成する。

entry document IDは次で決定する。

```text
<trace-session-id>-<zero-padded-sequence>
```

同一requestの即時retryはrequest fingerprintで重複保存を抑止する。同一entryのretryは同一document IDとなる。異なるpayloadで既存entryを更新することは禁止する。

## Event contract

`eventType`は自由文字列ではなくTypeScriptの有限unionで管理する。DBからの読込時もevent type、severity、snapshot reason、共通fieldを検証し、未知または破損したentryはsafe discardする。

初期catalogにはinterpreter、candidate、assumption、correction、readiness、feasibility、dialogue、fallback、preview、draft promotion、approval item、stale result、trace write failureを含む。

## Trust boundary

clientから保存したtraceは、debugとevaluation候補のための観測情報である。clientがpayloadを生成できるため、監査証跡、課金、authorization、security判定の根拠には使用しない。

application repositoryは認証user IDとsession／entryのownerが一致しない書込を拒否する。Firestore rulesは次を保証する。

```text
認証userは自分のsession／entryだけを作成できる
通常userはtrace documentをreadできない
admins/{uid}.enabled == trueの管理者だけが全session／entryをreadできる
sessionのownerとlogical identityは更新で変更できない
entryは作成後に異なる内容へ変更・削除できない
```

## Admin read path

viewerは独立したdebug routeではなく、既存の管理者画面へ統合する。

```text
/admin/weekly-planning-traces
```

route入口は`AdminApp`、権限境界は`AdminGuard`と`useAdminStatus`である。UIの非表示だけに依存せず、Firestore Rulesでも管理者以外のreadを拒否する。

管理者viewerは全userのsession summaryを取得し、選択されたsessionのentryだけを取得する。user／conversation ID、日時、status、error、fallback、preview、approval failure、stale resultで絞り込める。詳細はConversation、Events、State snapshots、Raw redacted JSONの4表示モードへ分離する。

件数増加時はcursor pagination、期間query、summary集計を追加する。現行の全session取得は初期運用向けであり、大規模運用前に置き換える。

## Redaction and export

redactionはviewerではなく書き込み前に行う。禁止keyは正規化してrecursiveに除去する。depth、array件数、object key数、string長、serialized sizeを制限する。

JSON export境界でも再度redactionとentry validationを行う。export bundleにはdebug JSON、DA3c evaluation fixture候補、メール・URL・電話番号をmaskしたroleplay候補を含める。roleplay候補は自動採用せず、人手確認を必須とする。

user発話contentは会話再現に必要なため保存対象である。したがって本番有効化はfeature flagで制御し、将来はmetadata-only modeと明示的な同意設定を分離する。

## Retention

session、turn、internal eventの`expireAt`は最終観測時点から90日とする。state snapshotは複製量が大きいため30日とする。

Firestore TTL policyの有効化はinfrastructure作業であり、application codeだけでは完結しない。TTL削除は即時ではないため、account deletionは別の明示的なcascade処理を必要とする。

## Failure behavior

repository write errorは捕捉し、domain処理のexceptionへ変換しない。失敗内容は有限なerror codeへ縮約してruntime内へ一時保持し、次にrepository書込が成功する機会に`trace_write_failed` eventとしてjournalへ追加する。同じ失敗中repositoryへ再帰的に書き込まない。

## Validation

Node 22で次を実行し、trace targeted test、週間計画全体、repository全体、production buildが成功することを確認する。

```sh
npm run test:run -- src/features/weeklyPlanning/trace
npm run test:run -- src/features/weeklyPlanning
npm run test:run
npm run build
```

Firestore TTL policyとaccount deletion cascadeはdeploy／運用作業である。Firestore Emulator固有のrules検証は利用可能な環境で別途実施する。


## 会話相関と予約eventの扱い

conversation lifecycle IDとrequest idempotency keyは別の識別子として扱う。同一文面や短時間という条件だけで別会話を統合しない。approvalとdraft promotionはpreview IDから元のlogical conversationを特定し、rendererは対応するstateからsessionを特定する。相関不能かつ同一userに複数のactive sessionがある場合は、誤ったsessionへ記録せずtrace追加を見送る。

`assumption_superseded`、`relative_constraint_resolved`、`relative_constraint_rejected`、`request_cancelled`、`stale_async_result_discarded`は有限catalog上の予約eventであり、現時点ではすべてにproduction producerがあるわけではない。対応する処理境界を実装するときにproducerと回帰テストを同時追加する。
