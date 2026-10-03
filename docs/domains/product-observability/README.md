# Product Observability

Status: canonical domain entry point
Updated: 2026-10-03
Owning Issue: #213

このドメインは、StudyPlanner 全体の利用状況・AI/API 利用・機能品質・運用状態を、管理者が分析し、個別障害まで掘り下げるための観測責務を所有する。

管理画面という「画面」そのものを owner にするのではなく、管理画面へ供給する telemetry、集計 read model、drill-down、診断導線を owner にする。UI はこれらの projection であり、集計規則や storage 実装を所有しない。

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

本ドメインが所有するもの:

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

本ドメインが所有しないもの:

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

管理consoleはOverview / Users / AI・API / Planning / Logs・Debug Bundle / Systemを実装している。初期Phaseの完了根拠・実行履歴は [canonical roadmap](roadmap/current.md)、追加要件の追跡先は [Issue #213](https://github.com/kame447/StudyPlanner/issues/213) とその関連Issueを参照する。入口文書に別のPhase待ち行列を持たせない。

UIは `src/services/adminObservabilityService.ts` のtyped query boundaryを通じて、Workerのbounded read model / restricted diagnostic projectionを読む。UI component自身で再集計せず、planner collectionのbrowser-side full scanを通常のadmin read pathへ戻さない。

詳細な週間計画traceは引き続きrestricted diagnostic layerであり、長期analyticsの正本へ昇格させない。
