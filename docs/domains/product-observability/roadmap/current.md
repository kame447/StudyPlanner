# Product Observability Roadmap

Status: canonical execution order
Updated: 2026-08-29
Owning Issue: #213

## Current phase

Phase 1「Canonical design」、Phase 2「Telemetry foundation」、Phase 3「Aggregation and read models」、Phase 4「Console shell and Overview」は完了済みである。

Phase 4はPR #224で`/admin`のOverview入口、responsive console shell、bounded read modelを利用するregistered / active user・AI/API・planning quality・read-model freshness表示、desktop/mobile・light/darkのrender regressionをmainへ統合した。最終pre-merge head `5d11dd2a574909aac0cfe3317652f4348a870d45` ではCI、Browser Regression、UI Quality Automation、UI Regression Matrix、Admin Overview Renderがすべてterminal successとなり、squash merge mainは`b053a677c00fea642a040831fd2161760567a382`である。

現在の実装phaseはPhase 5「Users and AI / API」である。delivery candidateはPR #234 / `feat/product-observability-phase5-users-ai-api`。Phase 4までに確定したbounded admin query / typed read modelをsource of truthとして、旧Users画面のbrowser-side full collection scanを通常read pathから外し、利用者分析・個別調査とAI/API利用分析を実装した。以降はこのcheckpoint以後のPR headをexact final validation対象として固定し、検証で不具合が出た場合だけ変更する。

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

Status: delivery candidate in draft PR #234; exact-head final validation in progress.

Active branch: `feat/product-observability-phase5-users-ai-api`
Parent Issue: #213
AI/API residual tracker: #160
Base main at phase start: `b053a677c00fea642a040831fd2161760567a382`

Usersのnormal read pathはprofiles / plans / actuals / todos / day_notesのbrowser-side full scanを廃止し、opaque `actorSubjectId`を基本とするbounded user summaryへ置換した。利用者全体では直近30日のdaily distinct actor推移をbounded Overview read modelから表示する。list / filter / sortは取得済みの最大100件単位で扱い、継続読込はcursor paginationとする。

個別調査はactor summary、canonical `observability_actor_day`へのCOUNT、保持中lightweight telemetryの最大50件cursor paginationを使う。timelineはproduct action、AI request、planning outcome、request / trace / feature session等のallowlistだけを返し、raw prompt / responseや任意payloadを返さない。

プロフィールから調査を始める場合だけrestricted identity resolverを使う。email / Firebase UID / usernameの完全一致・最大5件に限定し、analytics event / user summaryへemailやraw UIDを複製しない。actor directoryの参照はread-only lookupとし、調査によるmissで新しいactor identityを生成しない。登録日時はこのrestricted profile authorityから表示する。

AI / APIではdaily rollupの`aiByModel` / `aiByPurpose` / `aiByPhase` / `aiByOperationKind`をserver-sideで期間統合し、model・機能purpose・initial/repair/single・chat completion/OCR/添付解析/文字起こし等のoperation単位で比較する。各分類ではrequest、success/failure、prompt/completion/total/cached token、主要failure category、latency p50/p95、推定費用を表示する。UI component自身は期間再集計を行わない。

planning用途の効率指標はsession数で代用せず、weekly-planning domainが各turn開始時に一度だけ出すcanonical `turn_started`を分母とする。これによりrequest/turn、repair request率、完全に算出可能な場合だけcost/turn、cached token比率をserver-sideで導出する。`turn_started`導入前の履歴には正確なturn分母が存在しないため、分母0の期間は未計測として扱い、過去値を推測で補完しない。

#160のusage semanticsとして、OpenAIが返す`completion_tokens_details.reasoning_tokens`をraw usageとして保持する。cached input / cache-write / reasoningをproviderが返さない場合は0へ補完せずunknown/nullとする。pricing未定義時もraw usageは保持し、costだけを算出不能として分離する。

production AI transportはCloudflare AI proxyを正規経路とする。browser-direct OpenAI transportはdevelopment / evaluation互換に限定し、production contractから除外する。production buildでproxyが無い場合はdirect endpointへfallbackせずrules pipelineへfail closedする。

Usersのactor/filter/sort、AI/APIのfrom/to/environmentはURLへ保持し、調査文脈を再現可能にする。

専用Admin Render harnessはOverviewのみからOverview / Users / user detail / AI APIへ拡張した。desktop/mobile × light/darkの主要16ケースに加え、empty / unknown / error状態を検証し、root horizontal overflowも自動検査する。AI/APIの分類表はdesktop tableをそのままmobileで横スクロールさせるのではなく、mobileではlabel付きcard表現へ変換する。最初の拡張runでUsersの曖昧なtest locatorのみが失敗したため、user card内へscopeして修正した。実装監査中に個別利用日数COUNTのcollection名がPhase 3 canonical `observability_actor_day`と不一致だった問題も検出し修正した。

Final completion gate:

1. exact final headでTypeScript checksとfull Vitestを通す。
2. Firestore Rules regressionとproduction buildを通す。
3. Browser Regression、UI Quality Automation、UI Regression Matrixを通す。
4. expanded Admin Renderでdesktop/mobile、light/dark、empty/unknown/errorを通す。
5. PR #234の未解決review threadがないことを確認する。
6. gate通過後にPR #234をreadyにし、squash mergeする。

Phase 5 merge後の次のconcrete actionはPhase 6「Planning Analytics」である。weekly-planning typed outcomeだけをauthorityとしてsession funnelと品質比較を実装し、Phase 5で作ったAI request / feature-session / turn correlationを利用する。

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
