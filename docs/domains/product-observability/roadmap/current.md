# Product Observability Roadmap

Status: canonical execution order
Updated: 2026-08-30
Owning Issue: #213

## Current phase

Phase 1「Canonical design」、Phase 2「Telemetry foundation」、Phase 3「Aggregation and read models」、Phase 4「Console shell and Overview」、Phase 5「Users and AI / API」、Phase 6「Planning Analytics」は完了済みである。

現在はPhase 7「Log Explorer and Debug Bundle」をPR #256 / branch `feat/product-observability-phase7-log-explorer`で実装・検証中である。

Phase 7では詳細traceのownershipをweekly-planningから移さない。Product Observabilityはrestricted diagnostic adapterを介して、bounded / paginated / redacted projectionだけを共通Logs UIへ提供する。詳細traceをanalytics sourceへ昇格させず、通常の集計値をtraceから再構成しない。

Phase 7 merge後の次のconcrete actionはPhase 8「System and legacy removal」である。

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

- PR #216: typed telemetry contract、authenticated ingestion、opaque actor identity、idempotent persistence、retention、failure isolation。
- PR #217: production AI proxy request / outcome metricのdurable化。
- PR #218: provider実測token usage、cached/cache-write usage、versioned pricing boundary。未知値は0へ補完しない。
- PR #219: weekly-planning application layerが決定したtyped planning outcomeをanalyticsへprojection。trace本文やUI表示からplanning truthを再推論しない。

### Phase 3: Aggregation and read models

Status: completed by PR #220 and hardening PR #222.
Completion PR: #222
Merged main commit: `4d57ce510251005c636a707bd8ee4a058cf75a06`

actor-day presence、daily service / AI usage / planning quality rollup、pseudonymous user summary、mergeable latency histogram、rollup checkpoint、authenticated bounded admin read endpoint、typed browser query serviceを導入した。

登録ユーザー総数と期間内新規登録者はactivity telemetryから推測せず、profile registration authorityをserver-side COUNT aggregationで読む。canonical `registeredAt`はFirestore server timestampで作成し、legacy backfillが不完全な期間の新規登録数は0ではなくunknownとする。

normal admin read pathはraw telemetry / actor-day / profile本文を通常時に全件scanしない。rolling active userはdistinct actor union、late eventは`occurredAt`の日付へ反映、transaction retryは二重加算しない。

### Phase 4: Console shell and Overview

Status: completed by PR #224.
Completion PR: #224
Merged main commit: `b053a677c00fea642a040831fd2161760567a382`

`/admin`をOverview入口へ変更し、responsive console shellを導入した。登録ユーザー、今日・過去7日・30日の利用、主要product activity、AI/API、planning quality、read-model freshnessをbounded read modelから表示する。

UI component内で再集計しない。専用Admin Overview Render workflowをgeneral Browser Regressionから分離し、desktop/mobile・light/darkを実描画で検証する。

### Phase 5: Users and AI / API

Status: completed by PR #234.
Completion PR: #234
Merged main commit: `c47164427ad3f0d732b426f545430925e5ff8acf`
Final verified head: `5f603093f3c2c05a1427d3c6c306b9af541b0dc4`
Parent Issue: #213
AI/API residual tracker: #160

Usersのnormal read pathからprofiles / plans / actuals / todos / day_notesのbrowser-side full scanを外し、profile authorityのbounded pagination、opaque user summary、actor-day COUNT、bounded recent-error scanへ移行した。

個別調査はactor summary、actor-day COUNT、保持中lightweight telemetryのcursor paginationを使う。timelineはallowlistされたproduct action、AI request、planning outcome、request / trace / feature session等だけを返し、raw prompt / responseや任意payloadを返さない。

プロフィールから明示的に調査を始める場合だけrestricted identity resolverを使い、email / Firebase UID / usernameの完全一致・最大5件に限定する。

AI / APIはdaily rollupをserver-sideで期間統合し、model / purpose / phase / operation別のrequest、success/failure、token、failure category、latency、推定費用を比較する。未知値は0へ補完しない。

### Phase 6: Planning Analytics

Status: completed by PR #245.
Completion PR: #245
Merged main commit: `929c219a1c97f4e5fc854010bf6a0000597dfd72`
Final verified head: `f57ec28d28bf11baa7bffe405af72f9c04602774`
Parent Issue: #213

weekly-planning typed outcomeの`featureSessionId`をsession identity authorityとし、server-sideで軽量`observability_planning_session_summary`と開始日単位の`observability_planning_daily_rollups`をmaterializeする。

cohort日は`session_started`のAsia/Tokyo reporting dateで固定する。日を跨いだpreview / approval / save / failureも開始日のcohortへ差分更新し、期間内event件数同士を割る方式によるconversion歪みを避ける。

`/admin/planning`は開始session、Preview到達、承認開始、保存完了のfunnel、平均turn数、first Previewまでの平均turn数、failed / fallback / semantic repair / stale / unscheduled / approval failureをsession単位で表示する。

appVersion / schedulerVersion / promptVersion / model別比較はserver-side cohort read modelから返す。promptVersion / modelがplanning outcomeに無ければAI requestから推測せず`unknown`を保持する。`abandoned`はcanonical runtime authorityが未定義のため0ではなく未計測と表示する。

Phase 6 final gateではTypeScript、full Vitest、Firestore Rules、production build、Browser Regression、UI Quality Automation、UI Regression Matrix、Admin Overview Renderがexact headでsuccess、未解決review thread 0、merge直前main behind 0を確認した。merge後branchも削除済みである。

## Phase 7: Log Explorer and Debug Bundle

Status: implementation and exact-head verification in progress.
Active branch: `feat/product-observability-phase7-log-explorer`
Completion PR: #256
Parent Issue: #213
Initial implementation head: `7abf19f50c0ecfee18f536f704a28d79ac2cdceb`

### Architecture

weekly-planningの詳細trace schema / persistence / redaction ownershipはfeature側に残す。Product Observabilityは`ProductObservabilityWeeklyPlanningDiagnosticAdapter`をrestricted adapterとして利用し、共通Log Explorerがfeature-owned storageへ直接依存しない形にする。

診断readは通常の`admins.enabled`に加えて`weeklyPlanningTraceReader === true`を必須とする。管理者全員へ高感度traceを暗黙開放しない。

`/admin/logs`のsession一覧はWorker側のbounded cursor paginationを使い、新Logs導線からbrowser-side Firestore collection full scanを外す。entry本文も既存のbounded trace entry page boundaryを再利用する。

一覧の既定表示はtime / severity / feature / subject alias / trace session / request / event type / short result summaryに限定する。user input、assistant response、state diff等の詳細は既定一覧に表示せず、`Redacted detail`を明示展開した場合だけ確認する。

旧`/admin/weekly-planning-traces`は互換URLとして新Logsへ解決する。新Logs自体はread-onlyとし、legacy archive/write操作を持ち込まない。

### Debug Bundle

Debug BundleはWorkerで生成する`studyplanner-debug-bundle` schema v1とする。

bundleには次を含める。

- selected trace session / optional request scope / period
- subject alias / trace session / request correlation
- app / trace schema / model / prompt / scheduler version
- session status、turn / entry count、preview / approval failure / fallback / error signal
- permitted redacted diagnostic entry projection
- redaction policy summary
- entry / scan / byte limitとtruncation summary

weekly-planning admin redactionをbundle生成前にも適用し、raw Firebase UID、email、authorization、access/refresh/id token、password、secret、API key、trace subject token等を出さない。

### Phase 7 completion gate

1. exact final headでTypeScript checksとfull Vitestを通す。
2. Firestore Rules regressionとproduction buildを通す。
3. Browser Regression、UI Quality Automation、UI Regression Matrixを通す。
4. Admin RenderでLogsを含む全surfaceのdesktop/mobile × light/dark、Logs empty/error、horizontal overflowを通す。
5. restricted trace readが`weeklyPlanningTraceReader`を必須とすることを維持する。
6. Debug Bundleがversioned / bounded / redactedであり、list summaryがdiagnostic本文を既定表示しないことをtestで固定する。
7. PR #256の未解決review threadがないことを確認する。
8. mainに新規commitがある場合は同一branchへ追随し、追随後のexact headでgateを再実行する。
9. gate通過後にPR #256をsquash mergeし、branchを削除する。
10. #213へPhase 7 completion checkpointとPhase 8 next actionを記録する。

## Phase 8: System and legacy removal

telemetry ingestion、rollup freshness、AI proxy等のsystem statusを統合する。

新consoleのread pathが十分検証された後、不要になったbrowser-side full collection scanやduplicate admin aggregationを削除する。

Phase 7で互換URLとして残したlegacy trace URL / feature-specific admin surfaceも利用導線と依存を監査し、不要な実装を恒久fallbackとして残さない。

## Pull request policy

Issue #213をparentとして、各phaseをreviewableなrelease unitへ分ける。同じ失敗やretryを理由にreplacement Issue / branch / PRを増殖させない。

各PRはmerge前にcanonical roadmapのcurrent checkpointと次のconcrete actionを更新する。

完了済みPRのhead branchはmerge後に削除し、repositoryにはmain、active branch、明示的に正当化されたlong-lived branchだけを残す。
