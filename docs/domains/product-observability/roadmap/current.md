# Product Observability Roadmap

Status: canonical execution order
Updated: 2026-08-29
Owning Issue: #213

## Current phase

Phase 1「Canonical design」、Phase 2「Telemetry foundation」、Phase 3「Aggregation and read models」、Phase 4「Console shell and Overview」は完了済みである。

Phase 4はPR #224で`/admin`のOverview入口、responsive console shell、bounded read modelを利用するregistered / active user・AI/API・planning quality・read-model freshness表示、desktop/mobile・light/darkのrender regressionをmainへ統合した。最終pre-merge head `5d11dd2a574909aac0cfe3317652f4348a870d45` ではCI、Browser Regression、UI Quality Automation、UI Regression Matrix、Admin Overview Renderがすべてterminal successとなり、squash merge mainは`b053a677c00fea642a040831fd2161760567a382`である。

現在の実装phaseはPhase 5「Users and AI / API」である。Phase 4までに確定したbounded admin query / typed read modelをsource of truthとして、旧Users画面のbrowser-side full collection scanを通常read pathから外し、利用者分析・個別調査とAI/API利用分析を実装する。read modelに必要なprojectionが不足する場合はUI側集計で補わず、server-side bounded contractを先に拡張する。

## Completed foundation

### Phase 1: Canonical design

Status: completed by PR #215.

Canonical owner:

- `../README.md`
- `../spec/console-requirements.md`
- `../architecture/telemetry-and-read-model.md`

product-observability / weekly-planning / reporting / client-runtime の責務境界、privacy / retention、metric semantics、read-only admin boundaryを確定した。

### Phase 2: Telemetry foundation

Status: completed by PR #216 - #219.

PR #216 で typed telemetry contract、authenticated ingestion、opaque actor identity、idempotent persistence、retention、failure isolationを導入した。

PR #217 で production AI proxy request / outcome metricをdurable化した。

PR #218 でproviderが実際に返したtoken usage、cached/cache-write usage、versioned pricing boundaryを導入した。未知値は0へ補完せず、算出不能なcostは`null`として保持する。

PR #219 でweekly-planning application layerが決定したtyped planning outcomeをanalyticsへprojectionした。trace本文やUI表示からplanning truthを再推論しない。

## Phase 3: Aggregation and read models

Status: completed by PR #220 and hardening PR #222.

実装済みの主要責務は、actor-day presence、daily service / AI usage / planning quality rollup、pseudonymous user summary、mergeable latency histogram、rollup checkpoint、authenticated bounded admin read endpoint、typed browser query serviceである。

post-merge adversarial auditで、rolling active-userのnormal read cost、snapshot recovery / environment isolation / revision race、runtime read validation、登録ユーザーread model、profile registration timestamp authority、Firestore Rules回帰検証を追加でhardeningした。

登録ユーザー総数と期間内新規登録者はactivity telemetryから推測せず、profile registration authorityをserver-side COUNT aggregationで読む。新規profileのcanonical `registeredAt`はFirestore server timestampで作成し、作成後は利用者から変更できない。legacy profileはbounded service-account backfillを行い、移行が不完全な間の新規登録数は0ではなくunknownとする。

completion gateとして次を確認済みである。

- rolling active userが日次countの単純加算ではなくdistinct actor unionで定義される
- user summaryとdaily rollupがraw Firebase UID / email / prompt / user textを保持しない
- late eventを`occurredAt`の日付へ正しく反映できる
- malformed eventや失敗したrollupでcheckpointを不正に進めない
- transaction retryで二重加算しない
- p50 / p95をdaily percentileの平均から作らない
- observability failureがproduct operationのauthorityを変えない
- retentionとread-model lifecycleがboundedな運用契約になっている
- admin read pathがraw telemetry / actor-day / profile本文を通常時に全件scanしない
- 登録ユーザーをfirst activityで代用せず、profile authorityからbounded readする
- registration timestampがclientから偽造・事後変更できず、legacy backfill不完全時に新規登録数を0へ補完しない
- Firebase Emulator Suiteでprofile registrationのSecurity Rules契約を実動検証する
- exact merged mainでTypeScript、full Vitest、Firestore Rules regression、production build、Browser Regression、UI Quality Automation、UI Regression Matrixを通す
- 七視点監査でBLOCKER / MAJORが0件である

Completion PR: #222
Merged main commit: `4d57ce510251005c636a707bd8ee4a058cf75a06`

## Phase 4: Console shell and Overview

Status: completed by PR #224.

`/admin`をOverview入口へ変更し、管理目的ベースのconsole navigation shellを導入した。Overviewでは登録ユーザー、今日利用したユーザー、過去7日 / 30日利用、主要product activity、AI/API、planning quality、read-model freshnessを一画面から確認できる。

`WAU`等の略語だけを主表示せず、「過去7日間に利用したユーザー」のような意味を主表示する。未知のtoken / costは0へ補完しない。

UI component内で再集計せず、Phase 3のtyped admin queryとserver-side period aggregateだけを利用する。

Phase 4の最終検証で、専用`admin-overview-render.spec.mjs`がgeneral Browser Regressionの通常production previewに混入していたharness boundary defectを検出した。general suiteから専用specを分離し、専用Admin Overview Render workflowでは引き続き同specを正しいisolated harnessで実行する。修正後のexact headではgeneral Browser Regressionと専用render gateの両方がsuccessとなった。

Completion PR: #224
Merged main commit: `b053a677c00fea642a040831fd2161760567a382`

## Phase 5: Users and AI / API

Status: active implementation.

Active branch: `feat/product-observability-phase5-users-ai-api`
Parent Issue: #213
AI/API residual tracker: #160
Base main at phase start: `b053a677c00fea642a040831fd2161760567a382`

Usersでは全体trend、検索、filter、個別timeline、user → session → request / trace drill-downを実装する。既存`AdminUsersPage`の通常read pathはprofiles / plans / actuals / todos / day_notesをbrowserから全件scanしており、canonical architecture invariantに反するため、bounded observability/admin queryへ置換する。

個人のanalytics join keyはraw UID / emailではなくopaque `actorSubjectId`を基本とする。プロフィールからの調査開始が必要な場合はrestricted resolverを境界に置き、analytics eventへemail等を複製しない。個別調査は現在値のraw collection表示ではなく、登録・app利用・主要product action・AI request・planning outcome等のbounded timelineを中心に構成する。

AI / APIではmodel / purpose / phase別request、token、failure、latency、推定費用を表示する。daily rollupには既に`aiByModel` / `aiByPurpose` / `aiByPhase`が存在するが、期間集計をbrowserで再計算しないため、必要なperiod dimension aggregateはserver-side read modelで返す。

#160の残件として、providerがreasoning token等の追加usageを返す場合はraw factとして保持する。欠落値を0へ補完せず、pricing未定義時もraw usageは保持してcostだけを算出不能として分離する。direct AI pathがproduction contractとして残るかも実装経路を監査し、残る場合だけproxyと同じusage semanticsへ正規化する。

Current concrete actions:

1. Phase 3 read model / admin API / legacy Users read pathを監査し、Phase 5に必要なbounded query差分を確定する。
2. Users用のbounded list / detail timeline / restricted identity resolution contractをserver-sideで実装する。
3. AI/API用のperiod dimension aggregateと追加usage contractを実装する。
4. Users / AI APIのconsole UIを実装し、URLで期間・filter・actor等の調査文脈を保持する。
5. desktop/mobile、light/dark、empty/unknown/error状態をrender regressionで検証する。
6. exact final headでTypeScript、full Vitest、Firestore Rules regression、production build、Browser Regression、UI Quality Automation、UI Regression Matrix、Phase 5専用render inspectionを通す。

## Phase 6: Planning Analytics

weekly-planning typed outcomeからsession funnelと品質指標を作る。

preview / approval / save / failed / fallback / repair / stale / unscheduled等を期間・version別に比較できるようにする。

`abandoned`はruntime上の一意なauthorityが定義されるまで発火させない。

## Phase 7: Log Explorer and Debug Bundle

feature-owned diagnostic adapterを共通Log Explorerへ接続する。

詳細traceはrestricted diagnostic layerのまま扱い、analytics sourceへ昇格させない。

Debug Bundleはbounded / versioned / redactedなJSONとして生成する。

## Phase 8: System and legacy removal

telemetry ingestion、rollup freshness、AI proxy等のsystem statusを統合する。

新consoleのread pathが十分検証された後、不要になったbrowser-side full collection scanやduplicate admin aggregationを削除する。

legacy pathを恒久fallbackとして残さない。

## Pull request policy

Issue #213をparentとして、各phaseをreviewableなrelease unitへ分ける。同じ失敗やretryを理由にreplacement Issue / branch / PRを増殖させない。

各PRはmerge前にcanonical roadmapのcurrent checkpointと次のconcrete actionを更新する。

完了済みPRのhead branchはmerge後に削除し、repositoryにはmain、active branch、明示的に正当化されたlong-lived branchだけを残す。
