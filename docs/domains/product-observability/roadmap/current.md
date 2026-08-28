# Product Observability Roadmap

Status: canonical execution order
Updated: 2026-08-28
Owning Issue: #213

## Current phase

Phase 1 と Phase 2 は完了済みである。Phase 3「Aggregation and read models」の初回実装も PR #220 で main に統合済みだが、merge 後の監査で追加修正が必要になったため、現在は `fix/product-observability-phase3-audit` で Phase 3 の completion gate を再確認している。

Phase 4「Console shell and Overview」は、この監査・修正が完了して main へ統合されるまで開始しない。

管理UIを先に作って read model の不足をUI側集計で埋めない。Phase 3 の source of truth と bounded query contract を確定してからUIへ進む。

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

PR #220 で初回実装をmainへ統合した。

実装済みの主要責務は、actor-day presence、daily service / AI usage / planning quality rollup、pseudonymous user summary、mergeable latency histogram、rollup checkpoint、authenticated bounded admin read endpoint、typed browser query serviceである。

現在のpost-merge auditでは、Phase 4へ進む前に次をcompletion gateとして確認する。

- rolling active userが日次countの単純加算ではなくdistinct actor unionで定義される
- user summaryとdaily rollupがraw Firebase UID / email / prompt / user textを保持しない
- late eventを`occurredAt`の日付へ正しく反映できる
- malformed eventや失敗したrollupでcheckpointを不正に進めない
- transaction retryで二重加算しない
- p50 / p95をdaily percentileの平均から作らない
- observability failureがproduct operationのauthorityを変えない
- retentionとread-model lifecycleがboundedな運用契約になっている
- admin read pathがraw telemetry collectionを通常時に全件scanしない
- final HEADでTypeScript、full test、production build、diff check、Browser Regression、UI Quality Automation、UI Regression Matrixを通す

Current implementation branch: `fix/product-observability-phase3-audit`

このbranchのmergeをもってPhase 3 completionを確定する。

## Phase 4: Console shell and Overview

Phase 3完了後、navigation shellとOverviewを実装する。

Overviewでは、登録ユーザー、今日利用したユーザー、過去7日 / 30日利用、主要product activity、AI/API、planning quality、read-model freshnessを一画面から把握できるようにする。

`WAU`等の略語だけを主表示にせず、「過去7日間に利用したユーザー」のような意味を主表示にする。

UI component内で再集計せず、Phase 3のtyped admin queryだけを利用する。

## Phase 5: Users and AI / API

Usersでは全体trend、検索、filter、個別timeline、user → session → request / trace drill-downを実装する。

AI / APIではmodel / purpose / phase別request、token、failure、latency、推定費用を表示する。

AI/API usage・原価の細部残件は Issue #160 を #213 配下のtrackerとして扱う。reasoning token等、providerが返す追加usageは推測値で補完せずraw factとして保持する。

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
