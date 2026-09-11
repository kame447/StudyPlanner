# Product Observability Roadmap

Status: initial roadmap completed
Updated: 2026-08-31
Owning Issue: #213

## Current phase

Phase 1「Canonical design」からPhase 8「System and legacy removal」まで、Issue #213で定義したProduct Observability Consoleの初期ロードマップはすべてmainへ導入済みである。

Phase 8はPR #259で完了し、squash merge commitは`46a8d22a9a60e373947d2fd568286e0eaa5949ba`、final verified headは`0ea223165c6f1aa7fec228ebc73944f202ccbe98`である。

以後の機能追加は本ロードマップの継続Phaseとして暗黙に追加せず、既存metric / read-model semanticsと責務境界を維持したうえで、必要な要件を別途定義して扱う。

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

- typed telemetry contract、authenticated ingestion、opaque actor identity、idempotent persistence、retention、failure isolation。
- production AI proxy request / outcome metricのdurable化。
- provider実測token usage、cached/cache-write usage、versioned pricing boundary。未知値は0へ補完しない。
- weekly-planning application layerが決定したtyped planning outcomeをanalyticsへprojection。trace本文やUI表示からplanning truthを再推論しない。

### Phase 3: Aggregation and read models

Status: completed by PR #220 and hardening PR #222.
Completion PR: #222
Merged main commit: `4d57ce510251005c636a707bd8ee4a058cf75a06`

actor-day presence、daily service / AI usage / planning quality rollup、pseudonymous user summary、mergeable latency histogram、rollup checkpoint、authenticated bounded admin read endpointを導入した。

登録ユーザー総数と期間内新規登録者はactivity telemetryから推測せずprofile registration authorityを読む。normal admin read pathはraw telemetry / actor-day / profile本文を通常時に全件scanしない。rolling active userはdistinct actor union、late eventは`occurredAt`の日付へ反映、transaction retryは二重加算しない。

### Phase 4: Console shell and Overview

Status: completed by PR #224.
Merged main commit: `b053a677c00fea642a040831fd2161760567a382`

`/admin`をOverview入口へ変更し、responsive console shellを導入した。登録ユーザー、active users、主要product activity、AI/API、planning quality、read-model freshnessをbounded read modelから表示する。

UI component内で再集計しない。Admin Overview Render workflowでdesktop/mobile・light/darkを実描画検証する。

### Phase 5: Users and AI / API

Status: completed by PR #234.
Merged main commit: `c47164427ad3f0d732b426f545430925e5ff8acf`
Final verified head: `5f603093f3c2c05a1427d3c6c306b9af541b0dc4`
AI/API residual tracker: #160

Usersのnormal read pathからprofiles / plans / actuals / todos / day_notesのbrowser-side full scanを外し、bounded paginationとread modelへ移行した。個別調査はopaque actor identityを基本とし、profileから開始する場合だけrestricted identity resolverを利用する。

AI / APIはmodel / purpose / phase / operation別のrequest、success/failure、token、failure category、latency、推定費用をserver-side read modelから比較する。未知値は0へ補完しない。

### Phase 6: Planning Analytics

Status: completed by PR #245.
Merged main commit: `929c219a1c97f4e5fc854010bf6a0000597dfd72`
Final verified head: `f57ec28d28bf11baa7bffe405af72f9c04602774`

weekly-planning typed outcomeの`featureSessionId`をsession identity authorityとする。cohort日は`session_started`のAsia/Tokyo reporting dateで固定し、期間内の別event件数同士を割る方式でconversionを作らない。

`/admin/planning`はsession funnel、平均turn、品質signal、app/model/prompt/scheduler version比較をsession単位read modelから表示する。欠損model/promptVersionをAI requestから推測しない。`abandoned`はcanonical runtime authorityが未定義なら0ではなく未計測とする。

### Phase 7: Log Explorer and Debug Bundle

Status: completed by PR #256.
Merged main commit: `2e2aac2d62997f95169eb3fba4af5f4580ea9d8b`
Final verified head: `dee8790eabd040dfe97b80c5ed0b5663198be24a`

weekly-planningの詳細trace schema / persistence / redaction ownershipはfeature側に残す。Product Observabilityは`ProductObservabilityWeeklyPlanningDiagnosticAdapter`をrestricted adapterとして利用し、bounded / paginated / redacted projectionのみを共通Logsへ提供する。

診断readは通常のadmin権限に加えて`weeklyPlanningTraceReader === true`を必須とし、accessをauditする。通常一覧にraw user/assistant contentを出さず、詳細は`Redacted detail`の明示展開時だけ表示する。

Debug Bundleはserver-sideの`studyplanner-debug-bundle` schema v1として生成する。session/request correlation、version、lightweight metrics、許可されたredacted diagnostic projection、redaction/truncation summaryを含み、raw Firebase UID、email、Authorization/token、password、secret、API key、trace subject token等を含めない。

Debug Bundleはentry / scan / byte limitでboundedにし、詳細traceをanalytics authorityへ昇格させない。

## Phase 8: System and legacy removal

Status: completed by PR #259.
Merged main commit: `46a8d22a9a60e373947d2fd568286e0eaa5949ba`
Final verified head: `0ea223165c6f1aa7fec228ebc73944f202ccbe98`
Parent Issue: #213

### System status

`/admin/system`をread-only system surfaceとする。初期projectionは次を対象とする。

- AI proxy
- Firebase authentication / admin authorization
- telemetry storage / ingestion observability
- aggregation / read-model checkpoint freshness
- weekly-planning trace storage availability

System API自身が認証済みproxy経由で応答している事実と、既存Firestore stateへのbounded queryを利用する。新たなbrowser-side full scanや重い監視collectionを導入しない。

無通信やretained event 0件を障害と断定しない。query/storage availabilityとlast-observed freshnessを分離し、判定不能は`unknown`として表示する。

aggregationは5分cronを前提に、最終成功から15分超、最新failureが成功より新しい、または選択environmentのactive-user dirty sourceが残る場合をwarningとする。

System read modelにraw Firebase UID、ID token、Authorization header、trace本文等を含めない。詳細traceへのアクセス制御はLogsのrestricted boundaryを維持する。

### Legacy removal

新consoleへ移行済みで参照のない旧collection-centric `AdminReportViews`と専用testを削除した。

旧`/admin/weekly-planning-traces`互換routeを廃止し、Overviewとsidebarの利用導線を`/admin/logs`へ統一した。

新Logsが使用しないfeature-specific trace archive endpointを削除した。一方、Logs adapterが再利用するbounded trace entry loaderとweekly-planning trace domain/storage ownershipは維持した。

Overviewに残っていたPhase 5 / 6 / 8の「次フェーズ」disabled controlを廃止し、AI・Planning・Systemの実ページへ直接drill-downできるようにした。

### Phase 8 verification and cleanup

Exact final head `0ea223165c6f1aa7fec228ebc73944f202ccbe98` で次をすべてsuccess確認した。

- CI: run `33326541332`
- Browser Regression: run `33326541323`
- UI Quality Automation: run `33326541345`
- UI Regression Matrix: run `33326541330`
- Admin Overview Render: run `33326541328`
- unresolved review threads: 0
- merge直前のlatest mainに対してbehind: 0

CIではTypeScript checks、full Vitest、Firestore Rules regression、production build、PR diff checkを通過した。Admin RenderではSystemを含む対象surfaceのdesktop/mobile × light/dark、System empty/error、environment切替を検証した。UI Qualityではbundle budgetを緩和せず既存上限内を維持した。

PR #259をsquash merge後、head branch `feat/product-observability-phase8-system-legacy-removal`はone-shot cleanup workflow run `33326850084`でSHA固定・tree一致を検証して削除した。cleanup workflow自体も直後にmainから削除し、除去commitは`30ada23af7b81a2776c78458b76313fe9adb65bb`である。

## Completion

Issue #213で定義した初期Product Observability Console roadmapは完了した。

管理consoleはOverview / Users / AI・API / Planning / Logs・Debug Bundle / Systemの主要surfaceを持ち、通常read pathはbounded read modelをsource of truthとして利用する。分析値から必要な診断情報へrestricted boundaryを保ったままdrill downでき、privacy / retention / read-only admin boundaryと主要desktop/mobile導線を検証済みである。

今後のobservability拡張は、本IssueへPhaseを追加し続けるのではなく、変更対象のmetric semantics・責務境界・保持データを明示した別要件として扱う。

## Pull request policy

Issue #213をparentとして、各phaseをreviewableなrelease unitへ分ける。同じ失敗やretryを理由にreplacement Issue / branch / PRを増殖させない。

完了済みPRのhead branchはmerge後に削除し、repositoryにはmain、active branch、明示的に正当化されたlong-lived branchだけを残す。
