# Learning Consultation and Advice Contract

Status: canonical product requirement / implementation preflight complete
Updated: 2026-08-31
Owning Issue: [#246](https://github.com/kame447/StudyPlanner/issues/246)

Parent product intent: [product-intent.md](product-intent.md)
Current production runtime: [../architecture/current-contract-v5.md](../architecture/current-contract-v5.md)
Semantic ownership: [../architecture/weekly-planning-semantic-ownership-boundary-v5.md](../architecture/weekly-planning-semantic-ownership-boundary-v5.md)
Human grounding: [../policies/human-grounding.md](../policies/human-grounding.md)
Adaptive memory: [../policies/adaptive-memory.md](../policies/adaptive-memory.md)
Material metadata: [../../external-integrations/spec/material-metadata.md](../../external-integrations/spec/material-metadata.md)
Prompt / evidence design: [learning-consultation-prompt-and-evidence.md](learning-consultation-prompt-and-evidence.md)
Regression patterns: [../../../work/regression-patterns.md](../../../work/regression-patterns.md)
Test philosophy: [../quality/test-philosophy.md](../quality/test-philosophy.md)
Current roadmap: [../roadmap/current.md](../roadmap/current.md)

## 1. 文書の役割

この文書は、AI計画に「予定を作る前段階の学習相談」を追加するための正仕様である。

ユーザーが学習方針そのものを相談し、StudyPlanner内の現在情報にgroundされた助言を受け、ユーザーが採用した意思だけを既存Stable V5 planningへ安全に接続する。

代表例:

- 「数学の点数を上げたいけど、どの参考書をいつまでに仕上げればいい？」
- 「英語が苦手なんだけど、何から始めればいい？」
- 「この参考書が難しすぎるけど、変えた方がいい？」
- 「金フレが終わったら次に何をやればいい？」
- 「共通テスト数学を伸ばしたい。今の教材のままでいい？」
- 「この勉強法で間に合う？」
- 「なぜその教材がおすすめなの？」

production runtimeへ完全実装されるまでは [current-contract-v5.md](../architecture/current-contract-v5.md) がproduction baselineである。

本書では次を規範語として使う。

- 必須: 実装が満たさなければならない。
- 禁止: 実装してはならない。
- 推奨: 特別な理由がない限り従う。
- projection: 表示・集計・prompt入力・interaction選択等の派生値。source of truthではない。

## 2. Product goal

```text
user turn
→ deterministic active-interaction projection
→ typed high-level turn-purpose interpretation
   ├─ planning operation → existing Stable V5
   ├─ learning consultation
   ├─ consultation review / follow-up
   └─ unresolved / other
→ consultationならowner domainからbounded context取得
→ learning-advice answer purpose
→ AdviceProposal / clarification / explanation
→ user review
   ├─ approve
   ├─ request_revision
   ├─ request_alternative
   └─ dismiss
→ approve対象をcurrent contextで再検証
→ approved + current + fully-accounted-for scopeだけをStable V5 planning contributionへpromotion
→ readiness / scheduler
→ preview
→ Plan approval
→ save
```

最終目的はAIがそれらしい勉強法を話すことではない。

ユーザーが、目標・現在地・教材・予定・進捗にgroundされた案を理解し、修正・別案・終了を含めて自分で判断し、その意思だけがplanningへ反映されることを目的とする。

## 3. Non-negotiable invariants

```text
AI-generated advice
≠ user-stated fact
≠ user-approved planning strategy
≠ promoted planning condition
≠ preview
≠ saved Plan
≠ durable memory
```

承認も分離する。

```text
Advice approval
= この助言の特定scopeをplanning材料として使ってよい

Plan approval
= 実際に生成されたpreviewを保存してよい
```

必須不変条件:

1. renderer proseからmachine stateを再構成しない。
2. active proposal revision以外へreview commandを適用しない。
3. 1 proposal revisionにつき成功するadoption decisionは最大1回。
4. implicit short replyを受け取れるformal targetは最大1つ。
5. ActiveInteractionはunderlying formal statesから導出するprojectionであり、独立したmutable/persisted truthにしない。
6. review / promotionはstable operation identityとexpected revisionへbindする。
7. AI回答生成中に依存contextが変わった結果をcurrent proposalとしてcommitしない。
8. reviewable proposalと、それを表示するassistant presentationを別々の成功状態としてcommitしない。
9. reload後もreview対象・根拠・lineageをtyped stateから復元できる。
10. `empty / unavailable / omitted / stale / non_revalidatable`を同じ状態へ潰さない。
11. 相対期限は一度canonical valueへ解決し、後段でproseを再解釈しない。
12. unresolvedな教材名をcanonical material identityとして扱わない。
13. consultation clarificationとplanning clarificationを同じpending stateへ混在させない。
14. new proposal revisionを生成した同じturnだけで暗黙承認しない。
15. approved scopeのplanning-relevant contentをsilent partial promotionしない。
16. stale explanationはhistorical adviceをcurrent recommendationへ復活させない。
17. prompt用projectionをfreshness / identity / availabilityのSSOTにしない。
18. AdviceProposalを既存generic proposal / assumption proposalと同じidentity namespaceへ曖昧に載せない。
19. same-browser multi-tabをlocal read-check-writeだけで守ったことにしない。
20. promotion後の変更で過去ReviewDecision / PromotionReceiptを書き換えない。

## 4. Phase 1 scope

対象:

- 学習戦略
- 教材選択・教材遷移
- 目標分解
- 期限提案
- feasibility explanation
- 学習方法
- 複数案比較
- 理由説明

非対象:

- StudyPlannerと無関係な汎用assistant
- adviceから直接Planを書き込むshortcut
- 教材・試験ごとの巨大なdeterministic heuristic表
- 無制限autonomous web research
- AI回答の自動長期記憶化
- owner domainのSSOT複製
- item単位の部分承認
- cross-device consultation-state同期
- offline multi-device conflict resolution

Phase 1のreview単位はproposal全体、または複数optionのうち1 option全体。

same-browser multi-tab mutation safetyはPhase 1から必要である。

## 5. SSOT / ownership map

一つの事実・identity・authorizationに複数ownerを作らない。

```text
Bookshelf / StudyMaterial / #187
  registered material identity
  aliases / catalog link
  user-specific progress / pace

planner-data application boundary / #269
  planner source load availability
  ready / unavailable / stale distinction

userPlanningContext
  durable explicit user facts / preferences

Stable V5 Fact Graph
  accepted planning facts / lifecycle

Timetable / Plan / Actual / Reporting
  canonical domain state / deterministic aggregate

weekly-planning turn commit boundary / #270
  one logical turnのformal application commit
  conversation presentationとrequired staged domain stateの整合

client-runtime / #164
  local persistence policy
  local replica / migration
  multi-tab mutation coordination
  future local/cloud reconciliation

approval/server authority / #51
  final Plan-save uniqueness across devices

security / #152
  prompt-injection / trust / provenance policy
  stored / OCR / supplemental content boundary

product-observability
  service-wide metrics

weekly-planning #246
  consultation routing/state/review binding
  freshness orchestration
  promotion into normal Stable V5 planning
```

weekly-planningはowner domainのstable port/facadeを利用し、第二のidentity resolver、load-status inference、storage policy、security policy、final-save authorityを作らない。

## 6. SOLID requirements

### 6.1 SRP

consultation application serviceはflow orchestrationだけを所有する。

所有しない:

- 教材identity matching policy
- owner-domain storage
- context-source fetch/fallback policyそのもの
- localStorage / IndexedDBの具体実装
- provider SDK
- scheduler placement
- final Plan save

high-level turn-purpose interpreterは「どのsemantic purposeへ渡すか」だけを所有し、Stable V5 planning semanticsやAdviceProposal lifecycleを所有しない。

### 6.2 OCP

context source/provider追加はadapter/port追加で行う。

consultation coreへsource固有の巨大switchを増やさない。

### 6.3 LSP

context source adapterは共通contractを守る。

- source identity
- requirement
- availability
- authority
- canonical digest/basis
- provenance
- bounded items

adapter交換で`empty`やfreshnessの意味を変えない。

### 6.4 ISP

Answer AIへrepository/manager全体を渡さない。

promotion mapperへAI clientを渡さない。

### 6.5 DIP

weekly-planningはconcrete AI provider、localStorage、raw catalog responseへ直接依存せず、stable interfaceへ依存する。

## 7. Existing Stable V5との責任分離

### 7.1 Legacy `study_advice`はauthorityではない

current `PlanningIntent = 'study_advice'` を新consultation lifecycleのformal authorityとして流用しない。

### 7.2 Existing LearningStrategyProposalは別概念

current weekly learning-strategy proposalは週内capacity / memorization session等のplanning-side proposalである。

AdviceProposalと型・ledger・statusを共有しない。

### 7.3 Generic `proposal` referenceと分離

Stable V5のgeneric proposal referenceからAdviceProposalをmutationできてはならない。

Phase 1はconsultation advice専用reference family/namespaceを持つことを推奨する。

## 8. Turn-purpose routing architecture

### 8.1 Purpose boundaryの位置

相談判定を既存`WeeklyPlanningSemanticDocumentV5`へ押し込まない。

current production planning semantic documentはplanning semanticsのownerとして維持する。

その手前に、strict structured outputを持つ小さなhigh-level semantic purpose boundaryを置く。

概念:

```text
TurnPurpose
  planning_operation
  learning_consultation
  consultation_review
  consultation_followup
  unresolved / other
```

raw keyword/regexでrouteしない。

provider abstractionやstrict-response infrastructureは既存OpenAI-compatible clientを再利用できるが、schema/purposeはplanning semantic normalizerから分離する。

### 8.2 ActiveInteractionを先に解決する

short replyやreview follow-upでは、purpose classifierへ複数formal targetを選ばせない。

まずdeterministic applicationが現在のformal statesからActiveInteractionを投影する。

候補:

```text
none
planning_clarification
consultation_clarification
consultation_review
preview_approval
```

ActiveInteractionは保存しない。

underlying authority:

- planning clarification → existing planning question state
- consultation clarification → PendingConsultationClarification
- consultation review → active AdviceProposal + consultation lifecycle
- preview approval → existing preview/approval interaction state

複数authorityが同時にimplicit targetを主張したら、projection conflictとしてfail closedし、implicit mutationを行わない。

### 8.3 No active interaction

active targetがないturnだけ、high-level purpose interpretationでplanning consultation等をsemanticに分類する。

### 8.4 Result shape

consultation resultを`PlanningIntakeState`へ偽装しない。

application execution resultはconceptually discriminated unionにする。

```text
PlanningTurnResult
ConsultationTurnResult
ControlledFailureResult
```

planning branchは既存Stable V5 result contractを維持する。

### 8.5 Raw-text heuristic禁止

教材名、科目名、「おすすめ」「それで」等のkeyword/regexをformal route authorityにしない。

provider/validation failure時もlegacy parserへfallbackしない。

### 8.6 Mixed turn

`教材はそれで、期限だけ11月末にして、そのまま予定組んで`

- content変更 → new revision
- same turnのschedule要求でnew revisionをauto-approveしない
- fresh reviewを要求
- content変更なしならactive proposal approveになり得る

### 8.7 Cross-option composition

`Aの教材でBの期限`、`AとB両方`はapproveではなくrequest_revision。

new proposal + fresh approvalを要求する。

## 9. Answer output contract

Answer AI outputはexactly one:

```text
proposal
clarification
explanation
```

AIはformal adviceId / optionId / review status / validity / promotion statusを生成しない。

### Proposal

reviewable proposal candidate。複数option可。

### Clarification

recommendationを大きく変えるblocking inputが1つある場合だけ。

clarificationからAdviceProposalをcommitしない。

### Explanation

existing proposalのrationale / assumptions / evidence / trade-off。

strategy contentを変更しない限りnew revisionを作らない。

## 10. Consultation state

conversation-scoped advisory state:

```text
ConsultationSessionState
  consultationId
  ownerId
  conversationId
  revision
  lifecycle: active | closed
  activeAdviceId?
  activeAdviceRevision?
  proposals[]
  reviewDecisions[]
  validityChecks[]
  promotionOperations[]
  promotionReceipts[]
  pendingClarification?
```

ActiveInteractionはこのstateへ保存しない。

consultation revisionはformal commitごとに単調増加する。

### 10.1 AdviceProposal

最低限:

- adviceId
- consultationId
- revision
- sourceQuestionTurnId
- supersedes / supersededBy
- structured options
- assumptions
- evidence/dependency refs
- context fingerprint
- temporal resolutions
- material bindings
- answer snapshot
- createdAt

revisionをin-place mutationしない。

### 10.2 Active leaf

review可能なのはactive leafだけ。

new revision commit後のold revisionはhistory。古いUI/別tab/reload前commandでもapprove/revision/alternative/promotion不可。

### 10.3 Mutable aggregate statusをauthorityにしない

```text
review truth     = immutable ReviewDecision
freshness truth  = deterministic ValidityCheck
promotion truth  = immutable PromotionOperation / PromotionReceipt
```

UI statusはprojection。

## 11. Review contract

Phase 1 review scope:

- proposal
- one option

item-level partial approval不可。

ReviewDecisionには少なくとも:

- decisionId
- consultationId
- targetAdviceId
- expectedAdviceRevision
- expectedConsultationRevision
- targetScope
- action
- feedback
- sourceTurnId
- decidedAt

### 11.1 Adoption terminality

1 revisionにつきsuccessful approveは最大1回。

Aをapproveしたv1に後からBを追加approveしない。strategy changeとしてv2を作る。

### 11.2 Runtime concurrency

minimum guard:

- owner/conversation一致
- consultation active
- active leaf一致
- expected revisions一致
- target scope存在
- adoption未消費
- operation未適用

same-browser multi-tab serializationは#164 ownerへ委譲する。

## 12. Context source contract

Answer AIへplain arrayだけを渡さない。

```text
ContextSourceEnvelope
  sourceDomain
  sourceIdentity
  requirement: required | optional
  status: available | empty | unavailable | omitted | stale
  sourceBasis / revision
  semanticDigest
  observedAt
  authority
  bounded items
```

### 12.1 Emptyはsuccessful emptyだけ

load failure / timeout / permission / not-loaded / token omissionをemptyへ変換しない。

planner-data sourcesは#269のtyped availabilityを利用し、`items.length === 0`からavailabilityを推測しない。

refresh failure後に古い値を保持する場合はstaleとして扱う。

### 12.2 userPlanningContext

prompt selection projectionをavailability/freshness authorityにしない。

cloud repository state等のrevision/basisを取得できるowner portを使う。

local-only stateで読込失敗とauthoritative emptyを区別できない経路は、required sourceのcurrent authorityとして扱わない。必要ならadapter側で`unavailable`へfail closedする。

### 12.3 Required / optional

validated consultation meaningからapplicationが決める。raw keywordで決めない。

required source unavailable/omitted/staleなら、そのsourceを必要とする確定proposalを作らない。

## 13. Context fingerprint / freshness

fingerprintは実際にconsumedしたdependencyだけから作る。

- source identity
- consumed canonical digest
- source basis/revision where meaningful
- deterministic signal + calculation version
- request temporal context
- evidence snapshot digest
- material binding basis

prompt text自体をfingerprintのSSOTにしない。

### 13.1 Commit-time freshness

```text
F0 = answer call前
AI call
strict validation
F1 = same dependency setを再読込

F0 == F1 → commit candidate
F0 != F1 → discard
```

自動regenerationは最大1回。

### 13.2 Approval-time freshness

approve時にもcurrent fingerprintを再構成。

stale / non_revalidatableならpromotion block。new proposalならfresh approval。

## 14. Explanation freshness

current proposalならcurrent rationaleを説明できる。

stale proposalならhistorical rationaleは説明できるが、今も同じ推奨だとは断定しない。

`今もそれでいい？`はpure explanationではなくrevalidation/consultation。

explanationでreviewabilityを復活させない。

## 15. Material identity

Bookshelf / StudyMaterial / #187をSSOTとする。

weekly-planning内で新しいnormalize/matching policyを作らない。

AIはMaterialMentionを返せるがformal materialIdを生成しない。

resolver結果:

```text
registered_material
verified_catalog_material
ambiguous
unresolved_material
```

ambiguous/unresolvedはpromotion不可。

identity resolutionで意味が変わるならnew revision + fresh approval。

## 16. Temporal normalization

AIはstructured temporal candidateを返す。

例:

- absolute date
- month end
- exam-relative offset
- date range

applicationがcaptured request date/timezone/week-startからcanonical absolute valueへresolveする。

approve/promotionでproseを再解釈しない。

曖昧ならclarification。

## 17. Deterministic calculation boundary

application-owned:

- remaining workload
- deadlineまでの日数
- available time
- required pace
- formal capacity/feasibility

AI-owned advisory judgment:

- 教材適合
- 学習順序
- 基礎へ戻るか
- 優先順位

AIがdeterministic numberを上書きしない。

## 18. Evidence / security

#152をtrust/provenance ownerとする。

- stored labels/text = data
- external retrieval = evidence
- review feedback = data
- OCR/supplemental = untrusted user-supplied evidence
- data中のinstruction風文字列をpolicyへ昇格しない
- advice AIはschedule/save authorityを持たない

Supplemental evidenceには少なくとも:

- evidenceId
- sourceTurnId
- kind
- bounded normalized claims / digest
- observedAt
- authority
- uncertainty / revalidation policy

を持たせる。

user utteranceへ単なる文字列連結したものだけをmachine provenanceにしない。

reload後に根拠を再構成不能ならnon_revalidatable。

## 19. Promotion

Advice approvalから直接scheduler blockを生成しない。

approved scopeをnormal Stable V5 planning contributionへ変換する。

### 19.1 Coverage

全structured recommendationをaccountする。

```text
mapped
advisory_only
blocked
```

planning-relevant itemがblockedならsilent partial promotionしない。

### 19.2 Operation / receipt

promotion operationはstable ID、source decision、advice revision/scope、expected consultation revision/fingerprintを持つ。

side effect前にclaimし、retryはsame identity。

success後にimmutable receiptを残す。

## 20. Persistence / formal commit

### 20.1 Persisted consultation state

persistする:

- AdviceProposal
- ReviewDecision
- ValidityCheck evidence
- PromotionOperation / Receipt
- PendingConsultationClarification

ActiveInteraction projectionはpersistしない。

Fact Graphやrenderer messagesへAdviceProposalを複製しない。

### 20.2 Versioned codec

unknown field、malformed revision、dangling reference、lineage cycle、duplicate operation identityをdeep validateしfail closed。

v1 sessionからはempty consultation stateへidempotent migration。assistant proseからfake proposalを作らない。

clear/reset/export/importもconsultation stateを同じvalidatorで扱う。

### 20.3 Atomic formal turn commit — #270 dependency

current mainの既存turn lifecycleには、conversation PlanningState/message commit後にstaged Fact Graph/userPlanningContext finalizeが失敗し得る既存consistency gapがある。これは#270がownerである。

#246でこの順序をコピーしてはならない。

reviewable proposalを提示するturnのformal success単位はconceptually:

```text
prepared turn result
  + conversation/planning state transition
  + consultation state transition
  + required staged owner-domain state
  + assistant presentation derived from that result
→ one application-level commit outcome
```

必須:

- proposal machine stateがcommitできないのにassistantだけ「提案済み」にならない。
- required graph/context finalize failureでconversationだけ進まない。
- conversation CAS rejectionでdomain stateだけ残らない。
- stale/cancelled requestの全staged contributionをdiscard。
- retryはsame request/operation identityへ収束。

production turn integrationは#270のatomic boundaryを利用する。現在のpost-commit callbackへconsultation ledgerを追加して済ませない。

### 20.4 Multi-tab — #164

formal mutationは#164のsingle-writer/mutation coordinatorを利用する。

weekly-planning独自Web Locks/localStorage protocolを作らない。

### 20.5 Cross-device

consultation-state syncはPhase 1非対象。

final Plan saveは#51 server authorityを通る。

## 21. Post-promotion change

ReviewDecision/PromotionReceiptはhistory。

Plan保存前のstrategy変更はStable V5 normal correction/lifecycleでaffected planning stateをinvalidate/recompute。

Plan保存後はnormal Plan edit/correction ownerが変更する。

Advice ledgerがsaved Planをsilent rewriteしない。

## 22. Memory boundary

Advice/review feedbackはdurable memoryではない。

`今回は`と`今後も`をsemanticに区別する。

「今後もこのやり方にしたい」と明示された場合のみ別のdurable-context contribution candidateとしてowner policyへ渡し得る。

## 23. Failure behavior

- purpose routing failure → no planning mutation、必要なら1 repair/clarification
- required source unavailable → no fabricated proposal
- source drift → discard stale model result
- provider/validation failure → accepted state unchanged
- ambiguous review target → no guessed binding
- old revision/consumed adoption → stale/no-op
- ActiveInteraction conflict → no implicit mutation
- writer conflict → fail closed
- formal commit failure → no half-committed successful turn
- streaming interruption → no reviewable partial proposal
- dismiss → no auto regeneration

## 24. UX

- manual相談モード切替を必須にしない。
- Advice reviewとPlan保存を視覚・文言上分離。
- stale buttonはside effectなし。
- buttonはformal target ID / expected revisionへbind。
- ActiveInteraction conflict/transition後のold implicit actionはstale扱い。
- blocked promotionはユーザーへ隠さない。

候補:

```text
[この方針で進める]
[修正する]
[別の案を見る]
```

## 25. Streaming

streaming textはpresentation only。

validated final output + commit-time freshness + formal commitだけがproposalをreviewableにできる。

## 26. Observability

metricsはruntime authorityではない。

raw advice/OCR全文をdefault metric truthへ保存しない。

typed event/reason/IDs中心:

- route result
- advice generation success/failure
- clarification
- identity resolution
- review actions
- stale discard/block
- non-revalidatable block
- interaction conflict
- partial-promotion block
- writer conflict
- formal-commit rollback/failure
- promotion retry
- latency/token/cost

trace/metricsからmachine stateを復元しない。

## 27. Deterministic regression contract

### Routing / isolation

- planning turnは既存Stable V5へそのまま流れる
- learning consultationはplanning semantic documentへ偽装されない
- legacy `study_advice`はformal route authorityにならない
- generic proposalがAdviceProposalへcross-bindしない

### Review / authority

- adviceだけでFact Graph/preview/save mutationなし
- Option A approveがBへ漏れない
- approve A後same revision B approve reject
- item-level review reject
- cross-option composition → new revision
- mixed revision + schedule → no auto approve

### Active interaction

- planning clarificationとconsultation reviewが競合したらimplicit mutationなし
- consultation clarification short answerをplanningへbindしない
- preview interaction中にold advice short replyを誤bindしない
- reload後ActiveInteractionをunderlying stateから同じ結果へprojection
- ActiveInteractionを別persisted truthとして復元しない

### Revision / concurrency

- v2後v1 command reject
- double approve one effect
- approve vs alternative one winner
- two-tab same revision one formal mutation
- retry same operation no duplicates

### Context / freshness

- ready+[]とunavailableを区別
- first planner-data load failureをempty扱いしない
- retained old planner dataはstale
- prompt projectionをfreshness authorityにしない
- answer中Bookshelf/goal changeを検出
- approval直前changeをblock
- irrelevant source changeで不要なstale化なし

### Formal commit / persistence

- proposal machine state commit failureでassistantだけ成功しない
- required staged state finalize failureでconversationだけ進まない
- CAS rejectionでorphan domain stateなし
- stale/cancelでall stages discard
- answer → reload → approve
- revision → reload → latest only
- malformed consultation state reject
- v1 migration no prose recovery
- clear/reset/export/import

### Security / evidence

- OCR instructionはauthorityへ昇格しない
- supplemental provenance reload
- missing evidence → non_revalidatable
- conflicting user/supplemental evidenceをstring orderで解決しない

### Material / temporal

- registered material unique bind
- alias ambiguity fail safe
- same-name/different-edition separation
- unresolved material no promotion
- month/year/timezone/exam-relative normalization
- no approval-time prose reparse

### Promotion

- all recommendations dispositioned
- planning-relevant blocked → no silent preview
- rationale advisory-only
- post-promotion change uses normal correction

## 28. Real-model Japanese evaluation

最低限:

```text
「数学の点数を上げたいけど、どの参考書をいつまでに仕上げればいい？」
「英語が苦手なんだけど何から始めればいい？」
「この参考書難しいけど変えた方がいい？」
「金フレ終わったら次何やる？」
「なんでそれがおすすめ？」
「今もそれでいい？」
「それでいい」
「1つ目で」
「教材はそれで、期限だけ11月末にして」
「Aの教材でBの期限にして」
「AとB両方やる」
「教材はそれで、期限だけ11月末にして、そのまま予定組んで」
「その教材は嫌。別の案にして」
「いや、それも違う」
「もういい、今回はやめる」
「今後もそのやり方にしたい」
「このままで間に合う？ 無理なら少し増やして」
```

評価対象: route / interaction / context status / grounding / identity / temporal normalization / review terminality / freshness / promotion coverage / preview boundary / memory scope。

## 29. Browser / E2E

- consultation → answer: previewなし
- consultation → approve → preview
- multi-option → one option only
- old sibling / old revision action rejected
- alternative/revision/dismiss/rationale
- stale explanation
- cross-interaction short reply
- answer生成中source change
- approval直前source change
- blocked promotion
- reload continuity
- image evidence reload
- double tap
- two-tab conflict
- provider failure
- formal commit failure UX
- desktop/mobile

## 30. Issue #246 acceptance criteria

1. high-level purpose routeをexisting Stable V5 planning semantic contractの手前でtypedに分離する。
2. no raw-text semantic authority/fallback。
3. legacy study_advice / existing strategy proposal / generic proposalと二重authorityなし。
4. consultation execution resultをPlanningIntakeStateへ偽装しない。
5. proposal / clarification / explanation strict discriminant。
6. adviceだけでplanning/preview/save/memory mutationなし。
7. immutable proposal lineage / active leaf guard。
8. one revision / one adoption。
9. ActiveInteractionはprojectionであり独立persisted SSOTではない。
10. cross-option composition → new revision。
11. expected revision / operation ID。
12. #164 multi-tab coordinator利用。
13. commit-time / approval-time freshness。
14. stale explanationのhistorical/current分離。
15. #269またはequivalent owner portからsource availability取得。array lengthから推測しない。
16. owner snapshot/digestをfreshness SSOTにする。
17. temporal canonicalization。
18. #187 material identity resolver利用。
19. #152 supplemental provenance/trust利用。
20. promotion coverage / no silent partial apply。
21. immutable review/promotion history。
22. versioned/deep-validated consultation persistence。
23. no prose recovery。
24. #270 formal atomic turn commitをproduction integrationで利用。
25. retry/reload no duplicate effect。
26. promotion後はexisting readiness/scheduler/preview/Plan approval/saveを通る。
27. review feedback no auto durable memory。
28. deterministic calculations not AI authority。
29. SOLID/SSOT architecture regressionを固定。
30. deterministic / Real API / Browser Regression。
31. desktop/mobile。
32. exact current HEADでdocs/runtime同期。

## 31. Implementation phases

### Phase 0 — design / preflight

完了。

- requirements / prompt-evidence design
- prior-art review
- regression-pattern audit
- seven-view SOLID/SSOT audit
- current-main sync
- exact current runtime boundary audit
- existing-code defects separated to #269 / #270

### Phase 1A — pure consultation contracts (開始可能)

既存production mutationへまだ接続せず実装可能:

- TurnPurpose strict semantic contract
- ActiveInteraction projector + conflict guard
- consultation domain types/state machine
- AdviceAnswerDocument schema/validator
- ReviewDecision / lineage / terminality
- context envelope/fingerprint pure contracts
- temporal candidate normalization contract
- promotion coverage pure mapping contract
- unit/property/state-machine tests

### Phase 1B — owner adapters (dependency-aware)

- planner source availability → #269 contractを消費
- material identity → #187 contractを消費
- supplemental provenance → #152 boundaryを消費
- multi-tab writer → #164 contractを消費

ownerが未提供の能力を#246側で複製して埋めない。

### Phase 1C — production turn integration

#270のatomic formal turn commit boundaryを利用して:

- purpose routingをcurrent turn ingressへ接続
- answer purpose call
- consultation persistence
- presentation + machine-state atomic commit
- promotion into Stable V5
- Real API / Browser regression

#270未解決のまま、現行post-commit callbackへAdviceProposal保存を足してPhase 1Cを開始しない。

### Phase 2+

- item-level partial review
- richer comparison/catalog/evidence UI
- stronger material-disambiguation UX
- richer feasibility/Actual/Reporting
- trusted retrieval/RAG
- longitudinal coaching

## 32. Open implementation choices

open:

- exact TypeScript names/files
- ID string format
- persisted field names
- digest/hash algorithm
- streaming UI
- context budget
- historical compaction
- #164 single-writer technology
- external retrieval timing

not open:

- high-level route before Stable V5 semantic contract
- ActiveInteraction as projection
- proposal namespace separation
- one revision / one adoption
- expected revision/idempotency
- atomic formal turn outcome
- source availability distinction
- owner snapshot SSOT
- no prose recovery
- persistence deep validation
- temporal canonicalization
- material/security/storage owners
- promotion coverage
- mixed revision requires new approval
- post-promotion correction ownership

## 33. Dependency / owner Issues

- #269: planner-data load availability (`ready / unavailable / stale`) — required before #246 depends on planner arrays as authoritative current context.
- #270: weekly-planning formal turn atomicity — required before production reviewable proposal commit/presentation wiring.
- #164: storage/multi-tab coordination.
- #152: stored/supplemental prompt injection and provenance.
- #187: material identity/catalog/Bookshelf planning context.
- #51: final Plan approval multi-device uniqueness.

#246 may implement pure contracts in parallel, but must not recreate these owners locally.

## 34. Adopted external patterns

External patterns are design evidence, not StudyPlanner SSOT.

Adopted:

- stable approval target identity
- human decision as explicit state transition
- durable lineage / retry idempotency
- presentation separated from formal authority
- session/advisory state separated from long-term memory
- learner context / evidence / strategy / planning execution separation

Do not copy another project’s agent count, memory model, or UI as authority.

## 35. Final implementation preflight — 2026-08-31

Seven-view audit:

1. user-visible state transitions
2. SOLID / responsibility ownership
3. SSOT / identity / authority
4. persistence / migration / recovery
5. concurrency / idempotency / authorization
6. AI / evidence / security
7. integration / compatibility / regression / observability

Current-main preflight was repeated after syncing `main@08c896f7e39ef655c430cdbd1dae2e755c70567d` into the existing branch.

Confirmed:

- branch differs from that main only in Issue #246 canonical documentation before runtime implementation.
- current Stable V5 planning semantic schema remains planning-specific and can remain unchanged for planning turns.
- current OpenAI-compatible provider/strict response infrastructure can support a separate typed purpose/answer contract without coupling authority to UI.
- current request temporal context is captured before Stable V5 execution and can be reused as the consultation temporal basis.
- existing planning question state, existing learning-strategy proposal, and generic proposal namespace remain separate concepts and must not be reused as AdviceProposal.
- current controller correctly discards late results by pending-turn identity, but its formal commit order exposes the #270 existing-code defect.
- planner bootstrap/source state exposes the #269 existing-code availability defect.
- prompt-facing registered-material/user-context projections are insufficient as freshness SSOT; owner ports are required as specified above.

False positives explicitly rejected:

- cross-week conversation continuity is intentional current behavior, not a bug.
- apparent preview revision-name mismatch does not by itself prove an authority bug because current Stable V5 approval resolves against the bound runtime graph revision.
- `lastAssistantMessage` is not used as the current public semantic SSOT; current semantic context derives the last assistant message from the message ledger.

Gate decision:

- Product/architecture documentation gate: CLOSED.
- Phase 1A pure consultation implementation: READY TO START.
- Phase 1B owner integration: gated per #269/#164/#152/#187 where that owner capability is required.
- Phase 1C production turn integration: BLOCKED until #270 atomic formal turn boundary is available.

This distinction is intentional. A dependency blocker for production wiring must not force #246 to duplicate the missing owner, and it must not prevent safe implementation/testing of pure consultation contracts.
