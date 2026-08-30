# Product Observability Roadmap

Status: canonical execution order
Updated: 2026-08-30
Owning Issue: #213

## Current phase

Phase 1「Canonical design」、Phase 2「Telemetry foundation」、Phase 3「Aggregation and read models」、Phase 4「Console shell and Overview」、Phase 5「Users and AI / API」は完了済みである。

Phase 4はPR #224で`/admin`のOverview入口、responsive console shell、bounded read modelを利用するregistered / active user・AI/API・planning quality・read-model freshness表示、desktop/mobile・light/darkのrender regressionをmainへ統合した。squash merge mainは`b053a677c00fea642a040831fd2161760567a382`である。

Phase 5はPR #234でbounded Users / individual investigation / AI・API analyticsを実装し、exact head `5f603093f3c2c05a1427d3c6c306b9af541b0dc4`でCI、Browser Regression、UI Quality Automation、UI Regression Matrix、Admin Overview Renderをすべて通した後、`c47164427ad3f0d732b426f545430925e5ff8acf`としてmainへsquash mergeした。

現在はPhase 6「Planning Analytics」のcompletion candidate PR #245を検証中である。weekly-planning typed outcomeの`featureSessionId`だけをsession authorityとして、`session_started`のAsia/Tokyo日付へsession cohortを固定し、後日のpreview / approval / save / failure等を同じ開始日cohortへ差分反映するserver-side read modelを追加した。期間内event件数同士を割る方式や、詳細traceからanalytics historyを再推論する方式は採用しない。

Phase 6 merge後の次のconcrete actionはPhase 7「Log Explorer and Debug Bundle」である。

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

Status: completed by PR #234.

Completion PR: #234
Merged main commit: `c47164427ad3f0d732b426f545430925e5ff8acf`
Final verified head: `5f603093f3c2c05a1427d3c6c306b9af541b0dc4`
Parent Issue: #213
AI/API residual tracker: #160

Usersのnormal read pathはprofiles / plans / actuals / todos / day_notesのbrowser-side full scanを廃止した。通常一覧はprofile authorityを最大25件単位でdocument-name paginationし、server-sideで既存actor directory、opaque user summary、canonical `observability_actor_day` COUNT、保持中telemetryのbounded recent-error scanへ結合する。raw Firebase UID / emailは通常一覧DTOへ返さず、profile rowはOBSERVABILITY_IDENTITY_SECRETでHMACした`profileSubjectId`として表示する。

個別調査はactor summary、canonical `observability_actor_day`へのCOUNT、保持中lightweight telemetryの最大50件cursor paginationを使う。timelineはproduct action、AI request、planning outcome、request / trace / feature session等のallowlistだけを返し、raw prompt / responseや任意payloadを返さない。

プロフィールから明示的に調査を始める場合だけrestricted identity resolverを使う。email / Firebase UID / usernameの完全一致・最大5件に限定し、analytics event / user summaryへemailやraw UIDを複製しない。

AI / APIではdaily rollupの`aiByModel` / `aiByPurpose` / `aiByPhase` / `aiByOperationKind`をserver-sideで期間統合し、model・機能purpose・initial/repair/single・operation単位で比較する。各分類ではrequest、success/failure、prompt/completion/total/cached token、主要failure category、latency p50/p95、推定費用を表示する。UI component自身は期間再集計を行わない。

planning用途の効率指標はsession数で代用せず、weekly-planning domainが各turn開始時に一度だけ出すcanonical `turn_started`を分母とする。`turn_started`導入前の履歴は未計測として扱い、過去値を推測で補完しない。

production AI transportはCloudflare AI proxyを正規経路とし、proxyが無いproduction buildではdirect endpointへfallbackせずfail closedする。

専用Admin Render harnessはOverview / Users / user detail / AI APIまで拡張され、desktop/mobile × light/darkに加えてempty / unknown / errorとroot horizontal overflowを検証する。

Phase 5のexact final headではTypeScript checks、full Vitest、Firestore Rules regression、production build、Browser Regression、UI Quality Automation、UI Regression Matrix、Admin Overview Renderがterminal success、未解決review thread 0件を確認してmergeした。

## Phase 6: Planning Analytics

Status: implementation complete in completion candidate PR #245; exact-head merge gate is in progress.

Active branch: `feat/product-observability-phase6-planning-analytics`
Parent Issue: #213
Completion PR: #245

weekly-planning typed outcomeの`featureSessionId`をsession identityのauthorityとする。browser側や管理UIでraw telemetryを再集計せず、rollup transaction内で軽量`observability_planning_session_summary`と開始日単位の`observability_planning_daily_rollups`をmaterializeする。

cohort日は`session_started`のAsia/Tokyo reporting dateで固定する。sessionが日を跨いでpreview / approval / saveへ進んでも、後続結果は開始日のcohortへ戻して差分更新する。このため期間内に発生したevent件数同士を割る方式で起こる期間境界のconversion歪みを避ける。

管理UI `/admin/planning` は、開始session数、Preview到達、承認開始、保存完了のsession funnel、平均turn数、first Previewまでの平均turn数を表示する。`approvalReachedCount`の表示意味はtyped `approval_started` authorityに合わせて「承認開始」とし、承認完了と誤認させない。

品質シグナルはsession内で一度でも観測したfailed / fallback / semantic repair / stale / unscheduled / approval failureをsession単位のbooleanとして集計し、同一session内の複数発火で水増ししない。

appVersion / schedulerVersion / promptVersion / model別の比較をserver-side cohort read modelから返す。planning outcomeにpromptVersion / modelが存在しない場合、AI request集計から推測して結合せず`unknown`のまま保持する。session内でdimensionが複数値へ変わった場合は`__mixed__`として明示する。

`abandoned`はruntime上の一意なauthorityが未定義のため、0件として解釈せず管理UIで「未計測」と表示する。Phase 6導入前にrollup cursorを通過済みのweekly-planning trace / telemetryから履歴を再構成するbackfillは行わない。

normal admin readは最大93日の決定的なdaily cohort documentだけを読む。raw planning eventや詳細traceを通常readでscanしない。

専用Admin Render harnessはPlanningを追加し、Overview / Users / user detail / AI API / Planningをdesktop/mobile × light/darkで実描画する。Planning固有のempty / error、全surfaceのhorizontal overflowも検証する。

Phase 6 completion gate:

1. exact final headでTypeScript checksとfull Vitestを通す。
2. Firestore Rules regressionとproduction buildを通す。
3. Browser Regression、UI Quality Automation、UI Regression Matrixを通す。
4. expanded Admin RenderでPlanningを含むdesktop/mobile、light/dark、empty/errorを通す。
5. PR #245の未解決review threadがないことを確認する。
6. mainに新規commitがある場合は同一branchへ追随し、追随後のexact headで上記gateを再実行する。
7. gate通過後にPR #245をreadyにし、squash mergeする。
8. merge後にbranchを削除し、#213へPhase 6 completion checkpointとPhase 7 next actionを記録する。

Phase 6 merge後の次のconcrete actionはPhase 7「Log Explorer and Debug Bundle」である。feature-owned diagnostic adapterとrestricted trace boundaryを維持したまま、共通の探索・debug bundle導線を実装する。

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
