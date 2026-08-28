# Product Observability Roadmap

Status: canonical execution order
Updated: 2026-08-28
Owning Issue: #213

## Current phase

現在はPhase 2「Telemetry foundation」の最終release unitであるPR #219を検証中である。

Phase 1のcanonical設計はPR #215、lightweight telemetry ingestion基盤はPR #216、AI proxy request outcome metric基盤はPR #217、provider usage / versioned pricing boundaryはPR #218でmainへ統合済みである。

PR #219がmainへ統合された時点でPhase 2を完了し、Phase 3「Aggregation and read models」へ移る。管理UI実装はPhase 3完了まで開始しない。

## Phase 1: Canonical design

対象は次の3文書である。

- `../README.md`
- `../spec/console-requirements.md`
- `../architecture/telemetry-and-read-model.md`

完了条件は、Issue #213の要求が上記文書へ一意に配置され、weekly-planning / reporting / client-runtimeとのowner境界が明確で、current documentation navigationから到達できることである。

UI/runtime codeは変更しない。

Status: completed by PR #215.

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

Status: PR #219 mergeでcompleted予定。

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

`abandoned`はcatalog上予約するが、Stable V5のcancel / clear / resetのどれをanalytics上の離脱とするかcanonical semanticsが確定するまで発火させない。未定義の離脱をtraceやUI挙動から推測しない。

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

## Current checkpoint

Phase 1設計はPR #215でmainへ統合済みである。

Phase 2のPR #216ではtyped product activity contract、authenticated `/observability/events` ingestion、opaque actor identity、idempotent Firestore persistence、90日retention、telemetry failure isolationをmainへ統合した。

PR #217ではproduction AI proxy requestについて、chat completion、weekly-planning attachment、planning transcription、timetable OCRのrequest/outcome metricをbest-effortでdurable化した。request count、実際にroutingされたmodel、purpose、semantic initial/repair、proxy latency、request/response bytes、quota/provider/empty/invalid response等のstatusがmainで観測可能になった。

PR #218ではOpenAI-compatible provider responseが実際に返したusageだけをobservabilityへ伝播し、prompt / completion / total / cached / cache-write tokenを保持するversioned pricing boundaryをmainへ統合した。欠損値を0へ補完せず、現在安全に価格評価できないlong-context / attachment / unsupported provider・modelは`estimatedCostMicros=null`のまま保持する。

現在のactive branchは`feat/product-observability-planning-outcomes`、active PRは#219である。#219はweekly-planning application layerが既に決定したtyped lifecycle/outcomeだけをproduct-observabilityへprojectionする。session start、preview、semantic repair、unscheduled、fallback、stale、failure、approval start/completion、save completion、approval failureをtyped authorityから記録し、trace本文やUI表示からplanning truthを再推論しない。

#219では未知の観測値を0/falseへ変換せず`null`として保持し、raw Firebase UID、user text、prompt、assistant text、自由形式metadataをlightweight telemetryへ追加しない。telemetry sink / persistence failureはweekly-planning product operationを失敗させない。

`abandoned`は将来のplanning analytics用catalogに残すが、現在のStable V5にはanalytics abandonmentの一意なauthorityがないため発火させない。

#219の完了条件は、最終HEADでTypeScript、全test、production build、diff check、Browser Regressionが成功し、mainからの差分がtyped planning outcome projection / ingestion / tests / checkpoint責務に限定されていることである。

#219 merge後の次のconcrete actionはPhase 3である。actor-day presence、user summary、daily service / AI usage / planning quality rollup、latency distribution、rollup freshness/checkpoint、typed admin query serviceを、raw collection full scanを通常read pathにしない形で実装する。Phase 3完了まで管理UI実装へ進まない。
