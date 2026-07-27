# Stable V5 trace 空session重複 七視点監査

Status: audit complete / implementation not started
最終更新: 2026-07-27
Reviewed main baseline: `259c50b0becda18007f76709aa81b56db4997e97`
Issue: #89
Branch: `agent/trace-empty-session-seven-audit`

## 0. 症状と監査対象

管理者trace viewerで、同一subject、同一logical conversation、同一計画範囲に対し、次のsessionが時刻違いで複数表示された。

```text
status: active
turnCount: 0
entryCount: 0
logicalConversationId: 同一
planningRange: 同一
```

これはplanning window、scheduler、preview候補の重複ではない。trace transportにおいてserver session作成だけが成功し、entry appendが失敗した後、同じlogical conversationに別local session identityが発行される問題である。

監査対象は次の境界を一体として扱う。

```text
logical conversation ID
local trace session ID
server-issued session handle
request ID
entry sequence / turn index
browser cursor
remote append transport
Worker schema validation
admin list / archive表示
privacy / retention
```

## 1. Architecture視点

### 判定: BLOCKER

Stable V5 traceは次の二段階通信である。

```text
POST /weekly-planning-trace/session/start
→ server session documentをentryCount=0で作成

POST /weekly-planning-trace/append
→ entry documentを保存し、session metadataを更新
```

`weeklyPlanningTraceRemoteRepository.ts`はlocal session IDをidempotency keyとしてsession startを行う。一方、`weeklyPlanningStableV5TraceRuntime.ts`はappend成功後にだけbrowser cursorを保存する。

したがって次の部分成功が成立する。

```text
session/start成功
→ server上に空session作成
→ append失敗
→ browser cursor未保存
→ reloadまたはruntime memory消失
→ 同じconversationに新しいlocal session ID発行
→ 別server session作成
```

logical conversation identityとphysical session identityの継続が、remote start成功とlocal cursor commitの間でatomicではない。

### 必須不変条件

```text
同一owner + 同一logical conversation + explicit resetなし
→ append成否に関係なく同一local trace session IDを再利用
→ 同一server-issued session handleを再利用
→ remote append retryは同一entry IDで行う
```

## 2. Schema・transport contract視点

### 判定: BLOCKER

frontendとWorkerの契約に少なくとも三つの不整合がある。

#### B2-1 event catalog不一致

frontendの`WeeklyPlanningTraceEventType`は`stable_v5_debug_stage`を許可する。Worker側`TRACE_EVENT_TYPES`には同値が存在しない。

結果:

```text
Stable V5 debug stageを含むappend
→ Worker requireTraceEntrySchemaでreject
→ trace internal event entry schema is invalid
```

PR #86でfrontend producerだけが追加され、server validatorが同期されていない。

#### B2-2 document size不一致

frontendのdebug chunkはraw UTF-8 JSONを最大350,000 bytesで分割する。Workerは1documentを64KiB以下に制限する。base64化によりpayloadは約4/3へ増えるため、350KB chunkはserver contractを大幅に超過する。

#### B2-3 request size・entry count不一致

Workerは次を制限する。

```text
request body: 512KiB以下
entries per request: 100件以下
```

frontend remote repositoryは全entryを一回のappendへ渡し、byte sizeまたはentry countで分割しない。完全debug traceではstage数・chunk数により両上限を超え得る。

### 必須修正

- event catalogとtransport limitsをfrontend/Worker共通contractへ移す
- debug raw chunkをbase64・JSON envelope込みで64KiB未満になる値へ縮小する
- remote appendをentry countとUTF-8 body byte数の両方でbatch化する
- 各batchのsession.entryCountを、そのbatchに含む最大sequence + 1以上へ単調に進める

## 3. State atomicity・idempotency視点

### 判定: BLOCKER

現在はworking copyをappend成功後だけcommitするため、sequence消費を防ぐ点は正しい。しかし、session identityの初期永続化までappend成功へ従属させているため、初回失敗時にidentityが失われる。

必要なcommit境界を分ける。

```text
identity commit:
  local session ID / conversation / zero countersをremote start前にbrowser cursorへ保存

entry commit:
  append成功後だけnextSequence / nextTurnIndex / requestIds / metadataを更新
```

この分離により、初回append失敗後も同じsession IDでretryできる。entry counterは成功前に進めないため、immutable entry IDの冪等性も維持される。

複数batchの途中失敗では、成功済みbatchを再送してもimmutable同一payloadとして受理され、未成功batchから継続できることをテストで固定する。

## 4. Dialogue・UX・運用視点

### 判定: MAJOR

`hasUnexportedWeeklyPlanningTraceActivity`は`archivedAt`が無ければ無条件にtrueを返す。このためturnもentryも存在しないsessionを「未exportの活動がある」と表示する。

これは根本原因ではないが、server上の部分成功artifactを実活動と誤表示し、件数を水増しする。

必要な表示契約:

```text
turnCount === 0 && entryCount === 0
→ 未exportの活動として表示しない
```

historical empty sessionを自動削除・自動結合はしない。誤結合による監査情報改変を避け、TTLまたは明示cleanupへ委ねる。管理者UIは活動があるsessionだけを標準一覧へ出す。

## 5. Security・trust boundary視点

### 判定: MAJOR

server-issued structural ID、owner token、admin read権限は維持されている。今回の修正でraw Firebase UIDやcredentialをsession identityへ追加してはならない。

共通contractへ移す対象は公開可能な有限値だけとする。

```text
event type catalog
request/document/entry limits
transport safety margin
```

HMAC secret、subject token、authorization、server ownership判定は共有frontend bundleへ移さない。

retry時に別sessionを発行するのではなく同じserver handleを利用する。非構造的なnetwork/5xx failureでhandleを破棄しない既存方針を維持する。

## 6. Observability・privacy・data lifecycle視点

### 判定: BLOCKER

完全debug traceは観測目的で追加されたが、server validator不一致により、観測対象のturn自体が一件も保存されず、空sessionだけが残る。これはobservability機能が障害原因を隠す自己破壊状態である。

必要な観測項目:

- session start成功とappend失敗を区別できる
- batch index、entry sequence範囲、serialized bytesをclient debug/errorへ有限値で記録する
- admin session metadataのturnCount/entryCountと実entry列が整合する
- empty artifactは標準未export一覧から除外する
- cursor保存失敗はplanning本体を停止しないが、console warningと回帰testで可視化する

full debug payloadのcredential除外、redaction、retentionは維持する。chunkを小さくしても再構成時のlogical stage順序・debugSequence・chunkIndexを保持する。

## 7. Test・merge hygiene視点

### 判定: BLOCKER

過去の七視点監査はadmin exportによる実確認を最終gateに置いていたが、実機で同一conversationが一sessionになる証跡を得る前にmainへ統合された。PR #86のfrontend full-debug変更ではWorker validator・HTTP body limit・document limitを跨ぐcontract testが無かった。

今回の必須test matrix:

### Shared contract

- frontendとWorkerが同じevent catalogを参照する
- `stable_v5_debug_stage`が両境界で受理される
- debug chunk 1件がserver document上限未満

### Transport

- 100件超のentry列を複数requestへ分割する
- 512KiB相当を超えるentry列をbyte sizeで分割する
- 各request bodyが上限以下
- batchごとのentryCountが単調増加する
- 途中失敗後のretryが同じsession・同じentry IDを使う

### Session continuity

- 初回append失敗前にzero-count cursorが保存される
- runtime memory reset/reload後も同じlocal session IDを復元する
- remote startSession呼出しは同じidempotency keyとなる
- 同じconversationに二つ目のserver sessionを作らない

### Admin UX

- unarchivedでもturnCount=0かつentryCount=0なら一覧対象外
- activityが一件以上あれば未exportとして表示
- archived後の新規activityだけ再表示

### Verification gate

```text
focused trace tests
worker trace tests
weeklyPlanning trace full tests
npm run typecheck
npm run typecheck:build
npm run build
git diff --check
branch preview / main deploymentで実入力
admin viewerで同一conversationが1sessionかつturns/entries > 0
```

検証未実施のheadを採用可と記録しない。

## 8. 総括と実装順序

根本原因は一覧のgroupingではなく、frontend producer・Worker validator・transport limit・cursor commit境界の四者不整合である。

実装順序を固定する。

1. shared trace transport contractを追加
2. frontend/Worker event catalogを共通化
3. debug chunk sizeをserver上限内へ縮小
4. remote appendをentry countとbyte sizeでbatch化
5. Stable V5 zero-count cursorをsession作成時に先行保存
6. empty sessionを未export一覧から除外
7. transport/session/admin統合testを追加
8. canonical docsとtask placementを同期
9. 全自動検証後にPRを作成
10. 実機admin確認後のみIssueをclose

## 9. task placement監査

`docs/ai/tasks/`直下には未完了taskだけを置く。今回の実装taskは修正・検証中だけrootへ置き、完了時に`docs/ai/tasks/closed/`へ移す。

`20260724-weekly-planning-runtime-followups.md`はcross-tab、dialogue grounding、final trace durability等が未完了のためactiveのまま維持する。完了扱いにして移動してはならない。

過去のtrace基盤taskについてroot残存を確認し、Statusがimplemented/completedかつ残件を別taskへ分離済みのものだけをclosedへ移す。単にPRがmerge済みという理由だけで未完要件を含むtaskをclosedにしない。