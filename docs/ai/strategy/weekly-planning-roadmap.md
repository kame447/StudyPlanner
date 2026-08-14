# 週間計画 AI ロードマップ

Status: canonical / conversation quality and Luna simplification audit
最終更新: 2026-08-15

- Current status: [../weekly-planning-current-contract-status.md](../weekly-planning-current-contract-status.md)
- Semantic V5 roadmap: [weekly-planning-semantic-v5-roadmap.md](weekly-planning-semantic-v5-roadmap.md)
- Current execution task: [../tasks/20260814-weekly-planning-conversation-quality-luna-audit.md](../tasks/20260814-weekly-planning-conversation-quality-luna-audit.md)
- Human grounding / dynamic dialogue policy: [../tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md](../tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md)
- Test philosophy: [../testing/weekly-planning-test-philosophy.md](../testing/weekly-planning-test-philosophy.md)

## 0. 最上位設計原則

ユーザーの自然言語、会話文脈、訂正、quantity role、日付・曜日・時間帯、authorization intentの意味理解はAIが担当する。

deterministic codeはschema/reference/evidence validation、formal binding、Fact Graph lifecycle、revision/idempotency、readiness、scheduler、preview、approval、save、persistence、安全境界を担当する。raw user textをregex・keyword・dictionary・parserで再解釈してAIの意味を上書きしない。

AI orchestrationはmachine stateからsemantic責務を狭めるために使う。deterministic routerがユーザー発話の意味を判定してはならない。

rendererはtyped application decisionを自然な日本語へ変換する。renderer文面からsemantic stateを逆推定しない。

### 0.1 Human grounding / dynamic dialogue

会話品質の実装・監査では [PR #130 Human Grounding / Dynamic Dialogue Policy](../tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md) を必須参照とする。

正常系の対話をquestion codeごとの完成済み固定日本語で構成しない。deterministic codeは「何を確認するか」「何が未確定か」を所有するが、「どう言うか」はtyped decisionとgrounded contextを受けたAI rendererが発話系列に応じて自然に実現する。

共通基盤はFact Graphへ情報が保存されたことだけでは成立したとみなさない。直前のuser contributionを受け取ったことが必要に応じてacknowledgement、確認、言い換え、共有済み語彙の再利用、deterministicに確定した帰結等として会話上から観察できることを求める。ただしACK自体を固定prefixにしてはならない。

conversation-quality acceptanceでは、ユーザーを完全なform入力者として扱わない。短答、省略、後出し、訂正を通常ケースとし、次のuser utterance本文を事前に固定せず、各assistant turnを確認してから次turnを生成するdynamic turn-by-turn real-API evaluationを必須とする。固定unit/integration testはdeterministic invariantの検査として維持するが、自然な対話本文の全文一致を品質oracleにしない。

## 1. Production基準線

Stable V5が唯一のproduction週間計画runtimeである。

```text
user utterance
→ machine-state semantic router
   ├─ focused authorization AI
   ├─ focused contextual-answer AI
   └─ generic open-ended semantic AI
→ structural / evidence / reference validation
→ 必要時AI repair 最大1回
→ formal binding / canonical commit
→ Fact Graph V5
→ readiness / scheduler / dialogue decision
→ AI renderer
→ preview
→ approval / save
```

PR #109でStable V5主要経路を固定し、PR #112でproductionから到達不能なlegacy interpreter/parser/runtime/semantic experimentを削除した。PR #113でsemantic責務境界をmoduleへ分離した。

PR #120で旧実装思想の選別移植、human grounding / repair、real API hardening、scheduler human-scale化、prompt / orchestration監査を完了した。PR #129では残るfile-by-file refactorと最終Browser Regressionを完了しmainへmergeした。

現在は第2PR `agent/weekly-conversation-quality-luna-audit`で、過去の会話品質taskとIssueを現コードへ対応付け、Lunaによる逐次実API再観測、Issue #118の残差、heuristic敵対的回帰、prompt簡素化監査、最終previewを行う。Issue #52と#115は別scopeのまま維持する。

## 2. 現在の実行順序

古いPhase 4 / Phase 5表記はcurrent execution sequenceではない。

```text
1. stale task・Issue・PRと現コード回帰の対応付け
2. deterministic baselineとprompt byte実測
3. historical scenarioを固定transcriptではなく逐次dynamic real API Lunaで再観測
4. 各assistant turnを人間視点で確認し、明確な失敗ごとに停止・原因層修正・同地点再実行
5. Issue #118のcompleted-work pace会話policy完了
6. production heuristic inventoryと敵対的回帰
7. prompt複雑性分類とLuna ablation
8. 最終HEADのdynamic通し実API conversationからpreview
9. Browser Regression / normal CI / trace persistence
10. current MDと関連Issueのcloseout
```

詳細はcurrent execution taskとHuman Grounding / Dynamic Dialogue Policyを正とする。

## 3. 現在までに確立した会話・計画能力

- selectedDateと現実の発話日時を分離
- `来週`等のplanning range grounding
- weekStartsOn反映
- 今日の過去時刻への配置禁止
- corrected factのactive-only projection
- proposal acceptance / rejection grounding
- repair agendaによる確認優先度
- 局所self-repair
- human-scale effort質問
- page/problemのper-unit effort
- vocabularyのtotal/session effort
- vocabulary 100語上限session分割
- vocabulary sessionをpreviewまで保持
- session chunking / daily load distribution
- tiny-tail抑制
- heavy taskの長いfree segment優先
- existing plan / timetable buffer
- task relation ordering / cycle blocking
- request-time not-before
- reserve / review policy
- owner-scoped actual-derived effort calibration

旧実装にあった科目名→固定時刻、raw Japanese parser、根拠のない認知profile等は復活させない。

### 3.1 構造負債 hardening loop

構造負債は、1件を1 loopとして「このroadmapとcurrent execution taskを再参照 → 設計原則との整合確認 → 挙動不変の責務分離または明示的安全境界修正 → roadmap同期 → full CI」の順で処理する。CIが赤い間は次loopへ進まない。

関連・類似する機能は、単に同じファイルへ集約するのではなく、共通責務を内部へ隠し、利用側には小さく安定したapplication API / facadeだけを公開する。callerが内部条件、singleton、fallback順序、個別実装moduleを知る必要がある構造を避ける。型で表せる状態遷移はnullable値やnon-null assertionではなくdiscriminated union等の明示的contractを優先する。

完了済みの分離・hardening:

- execution profile / session policy / session splittingを分離し、旧public APIはfacadeで維持
- generic work item compilationからeffort estimation strategyを分離
- weekly placement orchestrationから単一work item placementを分離
- turn dialogue orchestrationからrenderer trace組み立て・記録を分離
- work distributionからtask relation orderingを分離し、full CI #2578 green
- approval persistence policyをrepository I/Oから分離し、full CI #2581 green
- session codecをlocalStorage transportから分離し、full CI #2585 green
- semantic turn phaseをRuntimeExecutorから分離し、full CI #2591 green
- turn trace persistenceをcommit/rollback side effectsから分離し、full CI #2595 green
- approval Firestore adapterをcomposition rootから分離し、full CI #2598 green
- approval memory adapterをcomposition rootから分離し、full CI #2601 green
- approval local planner adapterをcomposition rootから分離し、full CI #2604 green
- approval repository contractをcomposition rootから分離し、全adapterとcompositionが共通抽象へ依存するDIPへ修正。full CI #2610 green
- runtime session registryからrequest単位のFact Graph staging bufferを`weeklyPlanningStableV5GraphStaging.ts`へ分離。既存facade/APIとfinalize publication順序を維持し、full CI #2614 green
- graph staging bufferへ128件上限とoldest eviction、同一request置換contractを追加し、resource leakを防止。full CI #2617 green
- Stable V5 preview candidate metadataへcanonical task Fact由来のconversation provenanceを必須伝播し、ambient global stateからconversationを補わなくてもproduction候補が自己記述できるようにした。full CI #2622 green
- Stable V5 approval availabilityをpreview自身のconversationIdからconversation-scoped runtime sessionへ接続。別conversationのcurrent snapshotに影響されず、owner/revisionを対象conversationで検証する。初回CI #2625でproduction isolation登録漏れを検出し、監査を弱めず正式接続点として登録したうえでfull CI #2627 green
- Stable V5 preview変換からambient global runtimeによるconversation補完を削除。conversation欠落旧候補は別conversationを推測せずfail closedし、初回CI #2630で古いtest fixtureの暗黙依存を検出、fixtureを現production contractへ修正したうえでfull CI #2632 green
- 保存直前のapproval guardからglobal runtime参照を削除し、application境界が検証対象runtimeを明示入力する純粋contractへ変更。Stable V5は対象conversation以外へfallbackせず、actual saveの回帰も追加してfull CI #2644 green
- approval runtime選択を`weeklyPlanningApprovalRuntimeResolver.ts`へ集約し、availabilityとactual saveの二重実装を解消。Stable V5への直接接続点も2箇所から1箇所へ狭め、production isolation監査を縮小したうえでfull CI #2651 green
- Stable V5 runtime sessionからlegacy global runtimeへのpublish/clear bridgeを削除し、新旧runtimeを独立管理へ変更。hydrate/finalize/clear/resetでlegacy snapshotを上書き・消去しない回帰を追加してfull CI #2657 green
- Stable V5 scheduler candidateとpreview/draftで重複していたprovenance型を`weeklyPlanningPreviewProvenance.ts`へ単一化。既存型名はaliasで維持し、review情報を含む同一contractを生成からpreviewまで利用してfull CI #2662 green
- RuntimeExecutorからsemantic成功後のdeterministic planning evaluationを`weeklyPlanningStableV5PlanningEvaluation.ts`へ分離。horizon、grounding、scheduler compilation、repair/dialogue、authorizationの所有者を明確化し、architecture testも新ownerへ追従させてfull CI #2667 green
- RuntimeExecutorからpreview scheduler実行を`weeklyPlanningStableV5PreviewExecution.ts`へ分離。scheduler inputから配置、not-before、version/default/result traceまでを専用責務へ移し、full CI #2671 green
- RuntimeExecutorからsemantic成功後のuser planning context / Fact Graph staging副作用を`weeklyPlanningStableV5TurnStaging.ts`へ分離。durable context収集、transactional graph staging、対応traceの所有者を明確化し、full CI #2675 green
- ask-question / authorization / preview result等のresponse構築を`weeklyPlanningStableV5ResponseRouting.ts`へ集約し、`beforePreview` / `afterPreview`の小さいfacadeとして公開。pre-preview遷移は`respond` / `schedule_preview`のdiscriminated unionにし、caller側のnullable判定と内部条件重複を除去。初回CI #2676ではproduction isolation登録漏れだけを検出し、正式接続点として追従後full CI #2681 green
- planning evaluationと`runtime_scheduler_dialogue_evaluated` observabilityを`weeklyPlanningStableV5PlanningStage.ts`へカプセル化。pure evaluatorを副作用なしで維持し、RuntimeExecutorからevaluation内部fieldとtrace schemaを隠した。blocking-issue互換helperもstage経由へ寄せてfull CI #2687 green
- response facadeのplanning evaluator実装依存を除去し、`WeeklyPlanningStableV5PlanningEvaluation`出力contractへのtype-only依存へ変更。policy実装とresponse projectionの変更理由を分離し、full CI #2690 green
- RuntimeExecutor / planning stageの公開surfaceを監査し、実利用のない`getWeeklyPlanningStableV5BlockingIssueCode` wrapper/re-exportを削除。authorization互換re-exportは既存contractとして維持し、不要APIだけを選別して閉じてfull CI #2695 green
- InstrumentedRuntimeExecutorのfreshest graph付与・human-scale effort question rewrite・repair-safe preview保持を`weeklyPlanningStableV5ResultProjection.ts`へ集約。`core` / `duplicate`の小さいProjector facadeを公開し、graph non-null assertionも除去してfull CI #2700 green
- InstrumentedRuntimeExecutorからduplicate detection/result constructionを`weeklyPlanningStableV5TurnIdempotency.ts`へ分離。初回CI #2703で構造監査の旧期待とtrace文字列経由の`appliedTurnKeys`漏出を検出し、duplicate専用projection/traceをidempotency境界へ移してfull CI #2709 green
- InstrumentedRuntimeExecutorのtrace開始、turn input/output/error trace、final decision projection、error detail projectionを`weeklyPlanningStableV5RuntimeTraceLifecycle.ts`へ集約。`start / complete / fail`の小さいfacadeだけを公開し、duplicate固有traceはidempotency境界に残してfull CI #2714 green
- `weeklyPlanningTurnExecutor.ts`のfailure diagnostics lifecycle、failure state/code projection、AI renderer、最終result traceを`weeklyPlanningStableV5TurnResultProjection.ts`へ集約。公開executorは`begin / project` facadeとinstrumented runtimeだけを組み合わせ、failure status→codeも型付き対応表へ変更してfull CI #2719 green
- `weeklyPlanningTurnApplication.ts`のflatなside-effect service surfaceを、transactionalな`WeeklyPlanningTurnStagingLifecycle`とbest-effortな`WeeklyPlanningTurnOutcomeLifecycle`へ分割。初回CI #2726で旧test fixtureとmock typingの追従漏れを検出し、facadeを戻さずreal API observationを含むfixtureを新contractへ移行してfull CI #2731 green
- `weeklyPlanningTurnSideEffects.ts`からtrace function re-exportとpublic finalize/discard helperを除去し、factory + staging lifecycle facadeだけを公開。初回CI #2736でrenderer-trace testの旧re-export依存を検出し、test owner自体をtrace side-effect側へ移してfull CI #2739 green
- Stable V5 session bind・request clock生成・turn executor input mappingを`weeklyPlanningTurnRuntimeGateway.ts`へ集約。applicationは`runtimeGateway.execute()`だけを使い、full/resumable real API observationも同じgateway境界へ統一。production isolationのStable V5直接接続点もgeneric applicationからgatewayへ移し、full CI #2751 green
- approval preview source分類と具体runtime singleton取得を分離し、`weeklyPlanningApprovalRuntimeLookup.ts`へStable V5 / legacy compatibility lookupを集約。resolverはsource分類だけを担当し、既存behavior-aware承認互換を維持したままfull CI #2758 green
- `weeklyPlanningBehaviorAware*` clusterへのproduction依存をTypeScript ASTで監査。初回CI #2760で外部import 3本を検出したが、全て`import type`でruntime実行入口ではないことを確認した。監査をruntime edgeとtype-only edgeへ分離し、runtime edge 0本、既知type-only edge 3本を固定してfull CI #2761 green
- behavior-aware preview metadataを保存済み/旧preview互換の中立contract `weeklyPlanningPreviewCompatibility.ts`へ単一化。legacy preview bridgeは旧型名のtype re-exportだけを残し、production `weeklyPlanningPreviewBlocks.ts`は中立contractを直接参照するよう変更した。architecture監査はruntime edge 0本を維持し、既知type-only edgeを3本から2本へ縮小。コード変更時full CI #2767、roadmap同期後full CI #2768 green
- `weeklyPlanningRenderedQuestionContext.ts`のimport graphを確認し、現行productionで共有されるmoduleではなくbehavior-aware intake pipeline専用supportであることを確認。型をshared化せずlegacy closureの明示的support sourceとしてarchitecture contractへ含め、新たなproduction callerが生えれば検出する境界に変更した。runtime edge 0本を維持し、外部type-only edgeを2本から1本へ縮小。コード変更時full CI #2769 green

現在のloop:

- PR #129の最終HEADはnormal CIとBrowser Regression 80/80がgreenとなりmainへmerge済みである。
- 第2PRではrootに残る2026-08-07/10会話品質taskを未実装一覧として扱わず、現コードのmodule/testと照合したうえでLuna再観測scenarioへ変換する。
- 現時点で実装差分が確認できる既知項目はIssue #118のcompleted duration clarificationである。それ以外はまず逐次実APIで再現を確認し、再現しないhistorical workaroundを追加しない。
- prompt変更は意味責務・schema・validator・repair・trace persistenceの境界を同時に監査し、Lunaの性能向上だけを根拠にload-bearing contractを削除しない。

## 4. Prompt / orchestration方針

2026-08-12のreal API traceではopen-ended generic semantic requestが23,014 bytesだった。focused contextual route導入前には`8分くらいです。`というmachine-pending短答にも25,239 bytesのgeneric semantic requestを送っていた。

このため、generic promptは「まだcontext上限に余裕がある」ことを理由に拡張しない。問題はcontext上限よりinstruction density、相互制約、repair時の意味保持である。

追加仕様の判断順序:

1. JSON Schemaで表現可能ならschema
2. 意味を変えないrepresentation normalizationならdeterministic canonicalizer
3. exact pending targetがmachine stateで既知ならfocused AI
4. AI修復対象fieldが限定されるならfield-scoped focused repair
5. 複数意味を同時に統合する自由入力だけgeneric AI

validator errorが増えたという理由だけで、同じ規則をsystem prompt、validator、repair promptへ重複追加しない。

2026-08-14開始時点の実測はmeaning policy 3,575 bytes、supplemental policy 1,427 bytes、generic system 5,002 bytes、provider schema 11,333 bytes、representative generic request 17,351 bytesである。focused authorizationは1,202 bytes、focused contextual answerは2,263 bytesである。

Prompt budget gate:

- generic system prompt <= 9,000 bytes
- representative generic request including schema <= 23,000 bytes
- generic supplemental policy overhead <= 2,200 bytes
- focused authorization <= 2,500 bytes
- focused contextual answer <= 4,000 bytes
- focused request < representative generic request / 4

上限超過時は閾値を緩める前に責務分離を検討する。

## 5. オーケストレーションの次候補

既にfocused化済み:

- create-plan authorization
- missing effort answer
- quantity-role answer

次に評価する:

- pending work_breakdown
  - exact targetPublicIdがmachine stateで既知
  - 現在generic prompt / validator / repairに専用規則が分散している
- field-scoped temporal representation repair
  - planningWindow / exact clock / weekday representationなど、修復対象が局所化できる場合

初回自由入力を無条件に複数AI callへfan-outしない。task、量、期間、availability、modifier、relationが同じ発話内で相互参照するため、根拠なく分割するとidentity統合が不安定になる。

## 6. Real API hardening

real APIで観測されたoutput shapeを固定scenario oracleにはしないが、明確なcontract違反はvalidator / schema / orchestration境界の回帰へ変換する。

現在までに検出・対処した主な境界:

- canonical weekday token vs resolver compatibility
- pending短答がgeneric semanticで過去factを再掲する問題
- exact clockをcustom namedTimePeriodへ逃がす表現
- absolute planning windowの非ISO表現
- bare weekday token
- targeted repairが無関係task / availabilityを消すdestructive repair

成功するまでAPIを再実行するだけではなく、失敗shapeをtraceから取り出してformal contractへ落とす。

## 7. Testing gate

自動テストは決定論的contractを保証する。

禁止:

- fixed semantic quality oracle
- exact renderer wordingをAI品質contractにする
- prompt wordingそのものをexpectedにする
- prompt budgetを通すために上限だけ緩める
- failing regressionを削ってgreenにする

必須:

- typecheck
- full Vitest
- production build
- diff check
- semantic prompt budget
- focused/generic request budget差
- real API逐次会話
- real API通し会話
- final 7-view audit

## 8. 現在の会話品質PR完了gate

- current execution taskのfinal gateを全て満たす
- Human Grounding / Dynamic Dialogue Policyのacceptanceを満たす
- full CI green
- 最終HEADで逐次dynamic real APIがpreviewまで完走
- 最終HEADでdynamic通しreal APIがpreviewまで完走
- Issue #118の未完了会話policyが実APIで確認済み
- historical heuristicが対象・敵対的回帰でgreen
- prompt簡素化の維持・削除判断にbyte実測とLuna ablationの根拠がある
- prompt / orchestration auditで新たなBLOCKER/MAJORなし
- roadmap / semantic roadmap / current status / current contractが現コードと一致
- production heuristic inventoryがコード根拠付きで確定

このgateを満たすまで「完全に完了」としない。

## 9. 今回の別scope

Issue #52の週間計画UI大規模責務分離とIssue #115のraw-text regex routingは今回へ混在させない。今回の実API観測で接点を見つけても、証拠を記録するだけに留め、独立scopeを維持する。
- cross-tab / cross-device conflict handling
- trace production operations
- approval rollout
- personalization

現在のproduction contractを壊してまでhistorical designへ戻さない。