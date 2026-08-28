# Product Observability

Status: canonical domain entry point
Updated: 2026-08-28
Owning Issue: #213

このdomainは、StudyPlanner全体の利用状況・AI/API利用・機能品質・運用状態を、管理者が分析し、個別障害まで掘り下げるための観測責務を所有する。

管理画面という「画面」そのものをownerにするのではなく、管理画面へ供給するtelemetry、集計read model、drill-down、診断導線をownerにする。UIはこれらのprojectionであり、集計規則やstorage実装を所有しない。

## Read order

1. `spec/console-requirements.md`
2. `architecture/telemetry-and-read-model.md`
3. `roadmap/current.md`
4. Issue #213
5. current code / tests

## Canonical documents

- product intent / information architecture / metric semantics: `spec/console-requirements.md`
- telemetry / aggregation / trust / retention / drill-down architecture: `architecture/telemetry-and-read-model.md`
- current implementation order: `roadmap/current.md`

## Ownership

このdomainが所有するもの:

- product activity telemetryの意味と最小schema
- AI/API request metricの分析契約
- planning outcome metricの分析projection
- lightweight telemetryとdetailed diagnostic traceの分離
- service/user/AI/planning向け集計read model
- user → session → request/traceのcorrelation contract
- admin query service / repository boundary
- Debug Bundleの共通export contract
- 管理UIの情報階層と、専門用語を知らなくても読める表示方針
- observability dataのprivacy classification、retention、redaction方針

このdomainが所有しないもの:

- 週間計画runtime、semantic、scheduler、approval/saveの意味
- weekly-planning trace自体のruntime truth
- user-facing learning reportの集計規則
- client/server persistence authorityそのもの
- AI providerのsemantic decision

## Neighbor boundaries

### Weekly planning

`docs/domains/weekly-planning/` が週間計画のruntime truthを所有する。

product-observabilityはtyped outcomeや既存traceをconsumerとして読む。trace本文からplanning truthを再推論したり、analytics都合でweekly-planning lifecycleを変更しない。

trace privacy / lifecycleはIssue #45、production recoveryはIssue #89を引き続きownerとする。

### Reporting

`docs/domains/reporting/` はユーザー本人へ見せる学習レポートを所有する。

product-observabilityの管理者向け集計は別目的であり、user-facing reportの数値契約を流用して暗黙の管理指標へしない。

### Client runtime

`docs/domains/client-runtime/` とIssue #164がlocal/server authorityを所有する。

telemetryはbest-effort observationであり、planner dataやshared stateのauthorityにならない。

## Current implementation status

Phase 1のcanonical design、Phase 2のlightweight telemetry foundation、Phase 3のaggregation / bounded read model foundationはmainへ統合済みである。Phase 3ではactor-day presence、pseudonymous user summary、daily service / AI / planning rollup、mergeable latency histogram、rollup checkpoint、authenticated admin read API、typed browser query serviceを実装した。

PR #220の初回実装後に行ったpost-merge adversarial auditで、rolling active-userのnormal read path、snapshot failure recovery、environment isolation、revision race、read-model validation、登録ユーザーread authority、profile registration timestamp、Firestore Rules verificationをhardeningし、PR #222としてmainへ統合した。merged main `4d57ce510251005c636a707bd8ee4a058cf75a06` の七視点再監査と主要CI / browser gateも完了している。

管理画面の新UIはまだ未実装であり、現在の次phaseはPhase 4「Console shell and Overview」である。UI component自身では再集計せず、Phase 3のbounded admin query / typed read modelをsource of truthとしてOverviewから実装する。

現行legacy admin user summaryは複数planner collectionをbrowser側で全件取得して集計するため、新consoleの最終read pathとしては使用しない。

詳細な週間計画traceは引き続きrestricted diagnostic layerであり、長期analyticsの正本へ昇格させない。
