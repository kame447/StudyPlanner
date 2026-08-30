# Product Observability Telemetry and Read Model Architecture

Status: canonical architecture contract
Updated: 2026-08-28
Owning Issue: #213
Parent requirement: `../spec/console-requirements.md`

## 1. Problem statement

現在の管理者向けデータ取得は、通常のplanner collectionをbrowserから広く読み、表示時に集計する経路を含む。この方式は少人数では単純だが、ユーザー数、保存record数、分析指標が増えるほどadmin pageを開くたびにread量と転送量が増える。

一方、週間計画traceは詳細な障害調査には有用だが、prompt、response、state diff等の高感度・高容量情報を持ち得る。長期の利用分析をtraceの全件scanで成立させる設計にはしない。

AI requestについても、clientにはevaluation向けmetrics計測が存在するが、process memory / consoleを中心とするため、production analyticsのdurable sourceにはできない。

このarchitectureは、product behaviorのauthorityを変更せず、観測だけを独立して成立させる。

## 2. Architectural invariants

次の不変条件は実装方式より上位とする。

- telemetry failureはplan、actual、weekly planning、approval、save等のproduct resultを失敗させない
- telemetryはauthorization、scheduler decision、Fact Graph、saved planner dataのauthorityにならない
- raw contentと長期analytics metricを同じretention / access contractで保存しない
- admin UI componentはcollection scan、aggregation、pricing calculation、metric semanticsを所有しない
- request/eventのretryで同一行動を二重計上しない
- raw UID、email、prompt本文、assistant本文をlightweight metricの標準fieldにしない
- API key、Authorization token、Firebase token、provider secretをどのobservability payloadにも保存しない
- WAU / MAU等のdistinct actor metricをdaily countの単純加算で算出しない
- latency percentileをdaily p95の平均で算出しない
- existing weekly-planning traceからplanning truthを再推論しない
- observability read modelが遅延または欠損してもproduct runtimeを継続できる
- 登録ユーザー数をactivity telemetryのfirst activityから推測しない
- profile registration indexが不完全な期間内新規登録数を0へ補完しない

## 3. Considered architectures

### Candidate A: browser-side full scanを拡張する

現在のadmin user summaryと同様に、profiles、plans、actuals、todos、trace等をbrowserで取得し、その場で全指標を計算する。

支持する証拠は、既存実装を最小変更で再利用でき、初期ユーザー数が少ない間は理解しやすいことである。

この案が妥当になる条件は、データ量が長期的に小さく、admin利用頻度も低く、AI request等の新規metricsを既存collectionから十分再構成できる場合である。

しかし、ユーザー増加に比例してFirestore readと転送量が増え、period trendを表示するためにさらに広いscanが必要になる。AI requestのtoken / latency / failure等はplanner dataから再構成できない。個人情報をbrowserへ過剰に転送しやすい。

blast radiusはUIとdata serviceへ集計責務が集中し、後からserver-side read modelへ移す際に大きい。

よって最終architectureとして採用しない。

### Candidate B: raw event journalだけを作り、毎回queryする

すべてのproduct actionとAI requestをappend-only eventとして保存し、管理画面が期間filterでeventをqueryしてその場で集計する。

支持する証拠は、event historyが残るため柔軟な後追い分析ができ、planner collectionの全件scanを避けられることである。

この案が妥当になる条件は、event volumeが十分小さく、query costとlatencyが許容され、保持期間も短い場合である。

しかし、Overviewを開くたびに大量eventを読み直す問題が残る。distinct actor、rolling window、latency distribution等の集計がbrowserへ漏れやすい。長期分析のためevent retentionを延ばすほどprivacyとstorage costが増える。

blast radiusはevent schemaが事実上BI schemaになり、後から集計層を入れる際にconsumer依存が増える。

よってraw event journal単独は採用しない。

### Candidate C: lightweight telemetry + aggregated read model + detailed trace

軽量eventを短中期の観測journalとして保存し、それをserver-side aggregationが管理画面向けread modelへ投影する。高感度な詳細traceは別のrestricted / short-lived diagnostic layerとして維持する。

この案は、現在のplanner dataとweekly-planning traceの責務を崩さず、管理画面の日常的なread量をboundedにできる。AI/API metricsも本文を保存せず長期傾向を保持でき、必要な障害だけtraceへdrill downできる。

この案が誤りになる主な条件は、実際の運用で集計read modelが不要なほどevent volumeが恒常的に小さい、またはaggregation運用コストがraw queryより大きいことが計測で示された場合である。その場合でもUI contractをread model interfaceに限定していれば、内部implementationを簡略化できる。

blast radiusは新規ingestion / aggregation責務が増える点にあるが、既存product runtimeとUIから分離でき、段階導入可能である。

このためCandidate Cを採用する。

## 4. Logical layers

### Layer 1: Lightweight telemetry

長期傾向を作るための小さいstructured eventである。

本文を持たず、allowlistされたdimensionと数値だけを保存する。

初期taxonomyは概念レベルで次の4系統とする。

- product activity
- AI/API request metric
- weekly-planning outcome projection
- observability/system health event

event catalogはdiscriminated unionで管理し、任意`metadata: Record<string, unknown>`をproduction contractにしない。unknown fieldはingestion境界で拒否し、将来のPII混入を防ぐ。

### Layer 2: Aggregated read model

Overviewや各analytics pageが通常読むprojectionである。

少なくとも次のread modelを独立責務として提供する。

- service overview
- user activity / user summary
- AI usage
- planning quality
- system / pipeline freshness

UIはこれらのtyped query serviceだけを使用し、元eventやplanner collectionから同じ指標を再計算しない。

### Layer 3: Detailed diagnostic trace

個別障害調査だけに使用する高詳細データである。

週間計画trace等の既存feature-owned diagnostic storeを含む。

product-observabilityはtraceのruntime schema ownerにならない。restricted adapterを通じて必要なprojectionだけをLog Explorer / Debug Bundleへ提供する。

## 5. Telemetry source boundaries

### Client product activity

予定操作、学習実績、教材操作、app active等、clientでしか直接観測できない行動は`ProductTelemetryPort`相当のbest-effort boundaryから送信する。

product operation成功をtelemetry write成功に依存させない。

clientはraw Firebase UIDをevent payloadへ埋め込まない。authenticated ingestion側がactor identityを付与する。

### AI proxy

productionのAI request metricは可能な限りAI proxy側をcanonical observation pointとする。

proxyは実際に使用したprovider/model、purpose、usage、latency、HTTP/provider outcomeを知るため、client推測より信頼できる。

provider responseをユーザーへ返すことをmetric persistence成功に依存させない。metric write failureはbest-effortで記録し、AI response自体は返す。

quotaでprovider call前にrejectした場合も、`quota_rejected`としてrequest attemptを観測できるようにする。

local developmentでdirect providerを使用する経路はproduction aggregateのcanonical sourceにしない。必要なら`environment=development`として分離する。

### Weekly planning

週間計画analyticsはtrace本文を読み解いて状態を推測しない。

weekly-planning application layerが既に決定したtyped lifecycle/outcomeを、observability adapterへprojectionする。

例としてsession start、preview generated、approval completed、save completed、failed、fallback、repair、stale、unscheduled等を扱う。

planning eventの意味と発火条件はweekly-planning ownerが定義し、product-observabilityは集計方法だけを所有する。

### Account registration

登録ユーザー総数と期間内新規登録者はproduct activity telemetryから導出しない。登録済みだがまだ観測対象actionを行っていないユーザーを欠落させるためである。

current Firebase implementationでは`profiles`を登録済みaccountのproject-local authorityとして維持する。新規profile作成時にFirestore server timestamp `registeredAt`を記録し、Security Rulesで`registeredAt == request.time`を要求する。作成後のowner updateでは`registeredAt`を変更可能fieldに含めない。

legacy profileはservice-account boundaryのbounded backfillで既存`createdAt`をcanonical Firestore timestampへ移行する。解釈不能値を現在時刻やfirst activityで補完しない。

Overviewの日常readではprofiles本文をbrowserへ全件転送せず、server-side COUNT aggregationを使用する。profile総数とcanonical `registeredAt`を持つprofile数が一致しない間、総登録数は返してよいが期間内新規登録数は`unknown`として扱う。

登録数はFirebase project全体のaccount registrationであり、production / preview等のobservability event environmentとは別scopeである。read modelは`scope = firebase_project`を明示し、UIがenvironment別登録数と誤解しないようにする。

## 6. Common event envelope

すべてのlightweight telemetryは共通envelopeを持つ。

最低限次を含む。

```text
schemaVersion
eventId
eventType
occurredAt
observedAt
actorSubjectId
environment
appVersion
source
correlation
payload
```

`occurredAt`は発生時刻、`observedAt`はserver ingestion時刻とする。serverは`observedAt`をclient入力から信用しない。

`source`はfeature / component family等の低cardinalityなoriginをtyped enumで持つ。

`correlation`は存在する場合だけ次を持つ。

```text
appSessionId
featureSessionId
requestId
traceSessionId
stateRevision
```

任意のURL、email、free-form user textをcorrelationへ入れない。

## 7. Identity contract

analytics eventの基本join keyは`actorSubjectId`とする。

`actorSubjectId`はraw Firebase UIDとは別のopaque identifierであり、server-side `ActorIdentityResolver`が認証済みUIDから解決する。

実装はserver-managed random ID + restricted directoryを第一候補とする。telemetry storeにはraw UIDを複製しない。

restricted actor directoryだけが次のmappingを知る。

```text
firebaseUid <-> actorSubjectId
```

通常のanalytics queryはdirectoryを必要としない。

管理者が既知ユーザーからログへdrill downする場合、admin-authorized resolverがUIDをactorSubjectIdへ変換する。逆方向にuser profileを表示する場合もrestricted resolverを経由する。

actor directoryはaccount deletionに追随し、deleted accountを永久に再識別できるmappingとして残さない。

## 8. Idempotency and delivery

telemetry deliveryはat-least-onceを許容し、ingestionをidempotentにする。

client-origin eventはclient-generated correlation IDをそのままFirestore document authorityにせず、authenticated actor scopeとeventIdを組み合わせたserver canonical keyでdedupeする。

weekly-planning lifecycleのようにstate revisionを持つeventは、可能な場合`featureSessionId + stateRevision + eventType`をstable dedupe materialとして利用する。

AI request metricはrequestId / attempt identityでdedupeする。

retryで同じeventが再送されてもaggregateを二重加算しない。

## 9. Event taxonomy

### Product activity event

本文を持たず、featureとactionだけを記録する。

初期action候補は次のようなtyped catalogとする。

```text
app_active
plan_created
plan_updated
plan_deleted
actual_recorded
actual_updated
actual_deleted
todo_created
todo_completed
todo_updated
material_created
material_updated
weekly_planning_opened
```

このcatalogは「利用ユーザー」の意味に影響するため、追加時はmetric semanticsを同時に監査する。

### AI request metric

最低限次を持つ。

```text
operationKind
purpose
phase
provider
model
status
errorCategory
promptTokens
completionTokens
totalTokens
cachedTokens (providerが返す場合)
durationMs
requestBytes
responseBytes
pricingVersion
estimatedCostMicros
```

`status`と`errorCategory`は分離する。

初期error categoryは、少なくともquota rejection、timeout、network failure、provider HTTP error、empty/invalid provider response、schema/validation failure、cancelled、unknown failureを区別できる契約とする。

provider error body全文はlightweight metricへ保存しない。

### Planning outcome event

少なくとも次のdimensionを持てるようにする。

```text
featureSessionId
outcomeType
turnIndex
stateRevision
previewCount
unscheduledCount
fallbackUsed
repairUsed
staleObserved
approvalFailureObserved
appVersion
schedulerVersion
promptVersion
model
```

実際のlifecycle event catalogはweekly-planning canonical contractとの対応を確認してから固定する。

### System health event

telemetry ingestion failure、rollup failure、stale read model等、観測基盤自身の状態を表す。

同じtelemetry pipelineが完全停止した場合に自分自身のfailure eventも保存できないため、healthはlast-success checkpointやWorker/runtime logs等の独立signalも利用する。

## 10. Storage model

canonical contractはlogical roleをownerとし、physical collection名は実装で変更可能とする。

current stackでの第一候補はFirestoreを利用する次の分離である。

```text
observability_events
observability_actor_directory
observability_actor_day
observability_user_summary
observability_daily_rollups
observability_rollup_state
```

AI request eventをvolume/index/retention上分離する必要がある場合は専用collectionへ分けてよい。ただしUI contractは物理collection名へ依存しない。

### observability_events

短中期のlightweight append-only journal。

### observability_actor_day

`actorSubjectId + localDate`で一意となるactivity presence marker。

同じユーザーが1日に100回操作してもactive user countでは1人として扱うためのdedupe projectionである。

### observability_user_summary

actorごとのfirst/last activity、主要feature最終利用、累積count等、Users pageでbounded readするためのprojection。

profile dataのauthorityにはしない。

### observability_daily_rollups

日次のservice / AI / planning aggregate。

count、token sum、estimated cost、status count、mergeable latency distribution等を保持する。

### observability_rollup_state

aggregationのcursor、last successful run、freshness、schema version等を保持する。

## 11. Aggregation model

aggregationはbrowserで行わない。

`RollupEngine`相当のserver-side processがlightweight journalを読み、idempotently read modelを更新する。

実装はCloudflare Worker scheduled job等を利用できるが、UI contractを特定schedulerへ結合しない。

### Processing order

rollupは`observedAt + eventId`等のstable cursorで未処理eventを進める。

late eventは`occurredAt`に対応する過去bucketを更新できるようにする。

cursorを先に進めてaggregate writeを失う状態を禁止し、checkpoint更新とprojection適用のatomicity / retry contractを実装時にtestする。

### Active users

DAUはactor-day markerのdistinct countを使用する。

rolling 7-day / 30-day distinct actorはdaily countの加算では算出しない。

current implementationはactor-day markersまたはuser summaryを用いたexact projectionを第一候補とする。将来volumeが増えた場合はcardinality sketch等へ内部実装を変更してよいが、metric semanticsと誤差表示を変えずに導入しない。

historical WAU / MAU trendは日次rollup生成時にrolling windowのdistinct actor数を保存する。

### Registered users

登録ユーザー総数はprofile authorityのserver-side COUNTで取得する。期間内新規登録数はcanonical Firestore timestamp `registeredAt`のrange COUNTで取得し、reporting timezoneのAsia/Tokyo日付境界をUTC instantへ変換する。

`firstActivityAt`や`observability_user_summary`の件数を登録者数へ代用しない。登録はしたがまだ観測対象行動がない利用者を欠落させるためである。

legacy backfill完了可否はcheckpointだけで決めず、profile総数とcanonical registration timestampを持つprofile数のCOUNT parityをread時に確認する。不一致なら期間内新規登録数は`null`とし、UIが0人と誤表示しないようにする。

### Latency percentile

期間全体のp50 / p95をdaily percentileの平均から作らない。

AI rollupにはmerge可能なlatency histogramまたは同等のdistribution summaryを持ち、期間bucketをmergeしてpercentileを算出する。

bucket境界は実装contractでversion管理し、変更時に異なるversionを無条件mergeしない。

### Cost

推定費用はversioned pricing catalogを使用する。

pricing catalogはmodelごとのinput / output / cached等の単価とeffective periodを持つ。

request metricには利用した`pricingVersion`と推定費用を保持する。価格不明requestは0円にせず`unknownCostCount`へ分離する。

## 12. Read model interfaces

UIは少なくとも次のapplication query interfaceを通す。

```text
getOverview(range)
getUserTrend(range)
searchUsers(filter, cursor)
getUserObservabilityDetail(actorSubjectId, range)
getAiUsage(range, dimensions)
getPlanningAnalytics(range, dimensions)
searchOperationalLogs(filter, cursor)
getSystemObservabilityStatus()
getDebugBundle(selection, detailLevel)
```

実際のTypeScript interface名はimplementation時にcode conventionへ合わせる。

query resultには集計値だけでなく、`dataThrough`または`lastUpdatedAt`等のfreshness metadataを含める。

read modelが古い場合、UIは最新値のように黙って表示しない。

## 13. Diagnostic adapter and Log Explorer

Log Explorerはすべてのraw storeへ直接アクセスする巨大componentにしない。

featureごとにdiagnostic adapterを置き、共通の`OperationalLogEntry` projectionへ変換する。

週間計画ではcurrent trace repository / restricted admin APIがsourceとなる。

共通projectionは少なくとも次を持つ。

```text
timestamp
severity
feature
actorSubjectId
featureSessionId
requestId
traceSessionId
entryType
summary
detailRef
```

`summary`へ大量のraw JSONを埋め込まない。

full detailは`detailRef`からrestricted fetchする。

## 14. Debug Bundle contract

共通bundle formatは`studyplanner-debug-bundle-v1`から開始する。

概念schemaは次の構造を持つ。

```text
schema
bundleId
generatedAt
selection
correlation
versions
telemetrySummary
diagnosticEvidence
redaction
truncation
```

`selection`は対象actor/session/request/time rangeを表す。

`versions`は存在する範囲でappVersion、telemetrySchemaVersion、traceSchemaVersion、model、promptVersion、schedulerVersion等を持つ。

`diagnosticEvidence`はsource featureのrestricted adapterが許可した情報だけを入れる。

raw contentを含むbundleと含まないsummary bundleを区別できる`detailLevel`を持たせる。

truncationが発生した場合は黙って省略せず、対象field、元件数、含有件数をmetadataへ残す。

## 15. Data classification and retention

observability dataを概念上3段階へ分ける。

### Aggregate

個人を識別しない日次集計。

長期trendに必要なため、初期default retentionは約13か月を候補とする。

### Pseudonymous lightweight telemetry

actorSubjectIdやrequestIdを含むが本文を持たないevent / user summary。

初期defaultとしてraw eventは90日程度を候補とする。actor summaryはaccount lifecycleに追随する。

### Detailed diagnostic

prompt、response、user input、state diff等を含み得る高感度trace。

保持期間とconsentはfeature owner、とくにweekly-planningではIssue #45のcontractを優先する。

上記日数は初期運用defaultであり、privacy/legal reviewまたは実際の調査必要期間により短縮できる。延長は「分析に便利」という理由だけで行わない。

## 16. Access and trust boundary

clientからobservability Firestore collectionへ直接read/writeさせない構成を第一候補とする。

authenticated ingestion endpointがFirebase sessionを検証し、server-side actor identity、observedAt、environment等を付与する。

admin readも既存AdminGuardだけに依存せず、backend/rules側でadmin権限を検証する。

telemetry eventはsecurity audit logではない。client-origin eventはユーザー自身の行動観測として扱い、課金・権限・不正判定の唯一の根拠にしない。

profile registration timestampは例外的にaccount registrationのauthorityへ関与するため、client-provided時刻を信用しない。新規作成はFirestore server timestamp、legacy補完はservice-account boundaryに限定する。

## 17. Failure model

### Ingestion failure

client telemetry送信失敗はproduct action成功後に切り離して処理する。

bounded retryは許可するが、無限queueやlocalStorageへの無期限raw event蓄積は行わない。

### AI metric persistence failure

AI provider callが成功している場合、metric保存失敗を理由にprovider resultを捨てない。

### Rollup failure

raw lightweight eventを保持したままrollup checkpointを停止し、次回retryで再開できるようにする。

UIは`dataThrough`を表示し、古いrollupを最新データのように扱わない。

### Registration index migration failure

legacy profileのregistration timestamp migrationはbounded scheduled maintenanceとして実行し、失敗をlogin、plan save、weekly planning、telemetry ingestionへ伝播させない。

migration未完了または解釈不能profileが残る場合、Overviewは総登録数を返しても期間内新規登録数をunknownのまま維持する。migration failureを0人と解釈しない。

### Diagnostic source failure

trace取得に失敗しても集計dashboardは利用できる。逆にanalytics read modelが失敗してもfeature-owned trace viewerまで連鎖的に失敗させない。

## 18. Migration from current admin data path

### Step 1: architecture first

Issue #213の最初のPRではUI/runtimeを書き換えず、本contractを正仕様として追加する。

### Step 2: telemetry foundation

no-op対応可能なtyped telemetry port、server ingestion、actor identity、AI proxy metric、planning outcome bridgeを追加する。

既存admin UIはまだcurrent pathを使用する。

### Step 3: shadow read model

新read modelを構築し、既存collectionから計算した現在値と比較できる範囲だけparity auditを行う。

比較可能なのは現在のplan/actual/todo等から再構成できる指標だけである。過去のapp open、過去AI token等、観測していなかった事実を後から捏造しない。

profile registrationは元profileが明示的に保持するlegacy `createdAt`を限定的にcanonical timestampへbackfillしてよい。解釈不能な値は捏造せず、migration readinessをfalseにする。

### Step 4: cut over analytics reads

Overview / Users等を新query serviceへ切り替える。

legacy full-collection scanをfallbackとして恒久維持しない。cutover後に障害がある場合はread model defectを修正する。

### Step 5: advanced console

AI/API、Planning Analytics、Logs、System、Debug Bundleを新architecture上で実装する。

### Step 6: remove obsolete admin aggregation

新read modelのverification後、不要になったbrowser-side full scan / duplicate aggregationを削除する。

削除前にcurrent UI / tests / migration / fallback responsibilityが残っていないことを確認する。

## 19. Historical data policy

telemetry導入以前の行動履歴を、現在のplanner documentsから完全なevent historyとしてbackfillしない。

`createdAt`等、元documentが明示的に持つ事実は限定的なhistorical snapshotとして利用できるが、「その日にappを使った」「そのAI requestで何token使った」等、記録していない事実は推測しない。

consoleは`計測開始日`を保持し、期間がtelemetry開始前を含む場合はデータ不完全であることを示す。

既存weekly-planning traceから過去analyticsを一括生成することもdefault migrationにはしない。trace retention、consent、schema variationがあり、analytics truthと混同しやすいためである。

## 20. Verification requirements for implementation PRs

実装時には少なくとも次を独立に検証する。

- event schema rejects unknown / sensitive fields
- authenticated actor identity cannot be supplied by client
- duplicate delivery does not double count
- telemetry failure does not fail product operation
- AI success survives metric persistence failure
- rolling distinct user count is not daily sum
- registered user count does not substitute first activity for registration
- registration timestamp cannot be client-forged or changed after profile creation
- incomplete registration backfill exposes unknown new-user count instead of zero
- latency percentile aggregation uses mergeable distribution
- unknown pricing is not treated as zero cost
- rollup retry preserves exactly-once projection semantics at the read model level
- account deletion removes/revokes actor identity mapping according to lifecycle policy
- admin read is denied to non-admin users
- Debug Bundle excludes secrets and reports truncation/redaction
- cutover read models match legacy calculations where comparison is logically possible
- UI never recomputes canonical metrics from raw collections

## 21. What would invalidate this design

このarchitectureを固定観念として扱わない。

運用計測の結果、event volumeが極端に小さくserver rollupが不必要、Firestoreがanalytics workloadに不適切、または別のmanaged analytics storeの方が大幅に安全・安価であることが示された場合、physical storage / aggregation implementationは変更してよい。

ただし、lightweight analyticsとdetailed traceの分離、metric semanticsの単一owner、best-effort observation、stable drill-down identity、UIからstorage/aggregation責務を外すという境界は、別案がこれらをより安全に満たす証拠がない限り維持する。
