# 週間計画 AI ロードマップ

Status: canonical / PR #120 hardening and selective orchestration
最終更新: 2026-08-13

- Current status: [../weekly-planning-current-contract-status.md](../weekly-planning-current-contract-status.md)
- Semantic V5 roadmap: [weekly-planning-semantic-v5-roadmap.md](weekly-planning-semantic-v5-roadmap.md)
- Current execution task: [../tasks/20260812-weekly-planning-legacy-concept-migration-and-real-api-audit.md](../tasks/20260812-weekly-planning-legacy-concept-migration-and-real-api-audit.md)
- Test philosophy: [../testing/weekly-planning-test-philosophy.md](../testing/weekly-planning-test-philosophy.md)

## 0. 最上位設計原則

ユーザーの自然言語、会話文脈、訂正、quantity role、日付・曜日・時間帯、authorization intentの意味理解はAIが担当する。

deterministic codeはschema/reference/evidence validation、formal binding、Fact Graph lifecycle、revision/idempotency、readiness、scheduler、preview、approval、save、persistence、安全境界を担当する。raw user textをregex・keyword・dictionary・parserで再解釈してAIの意味を上書きしない。

AI orchestrationはmachine stateからsemantic責務を狭めるために使う。deterministic routerがユーザー発話の意味を判定してはならない。

rendererはtyped application decisionを自然な日本語へ変換する。renderer文面からsemantic stateを逆推定しない。

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

現在のPR #120では、旧実装思想の選別移植、human grounding / repair、real API hardening、scheduler human-scale化、prompt / orchestration監査を同じStable V5上で行っている。

## 2. 現在の実行順序

古いPhase 4 / Phase 5表記はcurrent execution sequenceではない。

```text
1. legacy実装・historical roadmap棚卸し
2. Stable V5へ採用する思想だけを選別移植
3. deterministic regression
4. full CI
5. 逐次real API conversation
6. 通しreal API conversation
7. prompt / orchestration監査
8. 7視点敵対的監査
9. current MD同期
10. production heuristic inventory確定
11. final CI / real API再確認
```

詳細はcurrent execution taskを正とする。

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

現在のloop:

- `weeklyPlanningTurnApplication.ts`がcommit / discard / failごとに個別の保存、trace、staged graph/context処理を知っているservice surfaceを縮小する。
- 必須のtransactional staging確定/破棄と、commit後のbest-effortな保存/traceは失敗意味が異なるため一つへ混ぜない。`WeeklyPlanningTurnStagingLifecycle`の`finalize / discard`と、`WeeklyPlanningTurnOutcomeLifecycle`の`committed / discarded / failed`という2つの小さいfacadeに分ける。
- `weeklyPlanningTurnSideEffects.ts`は既存のfinalize/discard実装を内部に保持しつつ`weeklyPlanningTurnStagingLifecycle`を公開する。
- `weeklyPlanningTurnOutcomeLifecycle.ts`を新設し、owned state保存とcommitted/discarded/failed traceの組み合わせを内部へ隠す。`failed`理由のdiscard traceは既存どおり重複記録せず、failure trace側へ任せる。
- `weeklyPlanningTurnApplication.ts`のservices contractから`saveOwnedState`、個別record関数、個別finalize/discard関数を除き、2つのlifecycle facadeへ依存させる。authenticated runtime identityとnormalized storage ownerの分離は維持する。
- application testはfacadeへの委譲を検証し、outcome lifecycle unit testで保存→trace順序とfailed discard抑止を検証する。architecture testで低レベルside-effect関数がapplication orchestrationへ戻らないことを固定する。
- 初回CI #2726ではproduction本体ではなく、旧flat service contractを使うtemporal/real-API observation fixtureと、unit testでinterfaceへcastしたため失われたVitest mock型をTypeScriptが検出した。facadeを戻さず、fixtureを`stagingLifecycle / outcomeLifecycle`契約へ移し、mockは構造的型付けのまま保持して修正する。
- AI意味理解・controllerのcommit semantics・scheduler・preview・approvalには触れず、application side-effect APIのSRP / ISP / encapsulationだけを改善する。
- このloopの完了判定は最終headのfull CI greenを必要とする。

次の敵対的監査対象は、最新headがgreenになった後にroadmapとcurrent execution taskを再読して選ぶ。legacy runtime production reachability、singleton依存、類似contract / helper重複、application service interfaceの残りを優先して疑う。

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

Prompt budget gate:

- generic system prompt <= 11,000 bytes
- representative generic request including schema <= 24,000 bytes
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

## 8. PR #120完了gate

- current execution taskのfinal gateを全て満たす
- full CI green
- 最終HEADで逐次real APIがpreviewまで完走
- 最終HEADで通しreal APIがpreviewまで完走
- prompt / orchestration auditで新たなBLOCKER/MAJORなし
- roadmap / semantic roadmap / current status / current contractが現コードと一致
- production heuristic inventoryがコード根拠付きで確定

このgateを満たすまで「完全に完了」としない。

## 9. PR #120後の候補

PR #120後も、古いroadmapをそのまま継承しない。現コード・real API観測・product goalから再評価する。

候補:

- focused work-breakdown semantic
- field-scoped semantic repair
- external source production adapter
- cross-tab / cross-device conflict handling
- trace production operations
- approval rollout
- personalization

現在のproduction contractを壊してまでhistorical designへ戻さない。