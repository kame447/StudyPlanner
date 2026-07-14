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

`logicalConversationId`はplanning runtimeの会話識別子である。trace session idは保存上の一意IDであり、idle timeout後の再開時には新しく生成する。

entry document IDは次で決定する。

```text
<trace-session-id>-<zero-padded-sequence>
```

同一entryのretryは同一document IDとなる。異なるpayloadで既存entryを更新することは禁止する。

## Trust boundary

clientから保存したtraceは、debugとevaluation候補のための観測情報である。clientがpayloadを生成できるため、監査証跡、課金、authorization、security判定の根拠には使用しない。

Firestore rulesは次を保証する。

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

管理者viewerは全userのsession summaryを取得し、選択されたsessionのentryだけを取得する。user ID、status、error、fallback、previewで絞り込める。

件数増加時はcursor pagination、期間query、summary集計を追加する。現行の全session取得は初期運用向けであり、大規模運用前に置き換える。

## Redaction

redactionはviewerではなく書き込み前に行う。禁止keyは正規化してrecursiveに除去する。depth、array件数、object key数、string長、serialized sizeを制限する。

user発話contentは会話再現に必要なため保存対象である。したがって本番有効化はfeature flagで制御し、将来はmetadata-only modeと明示的な同意設定を分離する。

## Retention

sessionとentryへ`expireAt`を保存する。初期値は最終観測時点から90日である。

Firestore TTL policyの有効化はinfrastructure作業であり、application codeだけでは完結しない。TTL削除は即時ではないため、account deletionは別の明示的なcascade処理を必要とする。

## Failure behavior

repository write errorは捕捉し、console diagnosticだけを残す。trace errorを同じ失敗中repositoryへ再帰的に書き込まない。domain処理のexceptionへ変換しない。
