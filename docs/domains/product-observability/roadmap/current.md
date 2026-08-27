# Product Observability Roadmap

Status: canonical execution order
Updated: 2026-08-28
Owning Issue: #213

## Current phase

現在はPhase 1「内部設計の確定」である。

このphaseでは管理UIの見た目を作り込まない。既存admin UIのCSS調整やdashboard card追加より先に、telemetry、identity、aggregation、read model、privacy、Debug Bundleの契約を確定する。

## Phase 1: Canonical design

対象は次の3文書である。

- `../README.md`
- `../spec/console-requirements.md`
- `../architecture/telemetry-and-read-model.md`

完了条件は、Issue #213の要求が上記文書へ一意に配置され、weekly-planning / reporting / client-runtimeとのowner境界が明確で、current documentation navigationから到達できることである。

UI/runtime codeは変更しない。

## Phase 2: Telemetry foundation

最初のruntime implementationでは、画面を増やす前に観測データを安全に作れる状態へする。

実装対象は概念レベルで次の並列責務である。

- typed telemetry event contract
- best-effort product telemetry port
- authenticated ingestion boundary
- opaque actor identity resolver
- AI proxy request metric capture
- weekly-planning typed outcome projection
- event idempotency / dedupe
- retention / access control
- unit / integration tests

このphaseのexit criteriaは、production product operationを壊さずlightweight telemetryがdurableに保存され、duplicate deliveryとsecret/PII混入を防げることである。

管理画面はまだlegacy data pathを利用してよい。

## Phase 3: Aggregation and read models

次に、管理画面がraw collectionを広くscanしなくても主要指標を取得できるread modelを作る。

対象は次の並列責務である。

- actor-day presence
- user summary projection
- daily service rollup
- AI usage rollup
- planning quality rollup
- latency distribution aggregation
- pricing catalog / estimated cost
- rollup freshness / checkpoint
- typed admin query service

このphaseではshadow comparisonを行う。

plans / actuals / todos等から現在も再計算できる既存指標だけ、新read modelとlegacy calculationを比較する。過去に観測していないapp activityやAI usageをbackfillして一致させようとしない。

exit criteriaは、主要read modelがbounded queryで取得でき、rollup delayとfailureを検出でき、comparison可能な指標で意味の差異が解消されることである。

## Phase 4: Console shell and Overview

内部source of truthができた後にUIへ入る。

最初にnavigation shellとOverviewを作る。

Overviewでは専門用語を主表示にせず、例えば`過去7日間に利用したユーザー`を表示し、`WAU`は補助説明として扱う。

ここで初めてdesktop / mobileのvisual hierarchyを設計する。

exit criteriaは、管理者が1画面から利用状況、AI/API、planning quality、system freshnessの異常を判断し、詳細ページへ移動できることである。

## Phase 5: Users and AI / API

Usersでは全体trend、検索、filter、個別timeline、session/request drill-downを実装する。

AI / APIではmodel / purpose / phase別のrequest、token、failure、latency、推定費用を実装する。

UIで再集計せず、Phase 3のquery serviceだけを利用する。

## Phase 6: Planning Analytics

weekly-planning typed outcomesを元にsession funnelと品質指標を表示する。

preview / approval / save / failed / abandoned / fallback / repair / stale / unscheduled等を期間・version別に比較できるようにする。

このphaseでtrace本文をanalytics sourceへ昇格させない。

## Phase 7: Log Explorer and Debug Bundle

feature-owned diagnostic adapterを共通Log Explorerへ接続する。

週間計画についてはexisting restricted trace APIを利用し、Conversation / decision / state diff / scheduler / error等をtimelineとして追えるようにする。

Debug Bundle v1を実装し、AI/agentへ渡す調査JSONをbounded / versioned / redactedな形で生成する。

## Phase 8: System and legacy removal

最後にtelemetry ingestion、rollup freshness、AI proxy等のsystem statusを統合する。

新consoleのread pathが十分検証された後、不要になったbrowser-side full collection scanやduplicate admin aggregationを削除する。

legacy pathを障害時の恒久fallbackとして残さない。

## Pull request policy for this Issue

Issue #213は一つのlogical taskであるが、内部基盤とUIまで一つの巨大diffにしない。

Phase 1のcanonical designはdocumentation-only PRとしてmerge可能な独立単位にする。

Phase 2以降のruntime implementationへ進む際は、Issue #213をparentとしてcurrent repository policyに従いreviewableなrelease unitへ分ける。ただし同じphaseの失敗やretryを理由にreplacement branch / PRを増殖させない。

各implementation PRはIssue #213のcurrent phase/checkpointを更新し、完了したphaseと次のconcrete actionを明示する。

## Current next action

Phase 1文書をdocumentation navigationへ登録し、exact diffとlink integrityを確認してPRをreviewable状態にする。