# Learning Consultation Prompt and Evidence Design

Status: supporting design / implementation preflight aligned
Updated: 2026-08-31
Owning Issue: [#246](https://github.com/kame447/StudyPlanner/issues/246)
Parent canonical: [learning-consultation-and-advice.md](learning-consultation-and-advice.md)

## 1. この文書の位置付け

この文書は、learning-advice answer purposeへ何を渡し、どのauthorityで回答させ、何をstructured outputとして受け取るかを定義する。

親仕様が正本であり、矛盾時は親仕様を優先する。

本書が所有するもの:

- answer-purpose fixed instructions
- Source Policy
- prompt-facing bounded context
- deterministic signal presentation
- Evidence Bundle / Supplemental Evidence
- exact current user question
- Review / Explanation Context
- AdviceAnswerDocument output contract
- answer-model evaluation

本書が所有しないもの:

- high-level turn-purpose routing authority
- ActiveInteraction projection
- formal advice/option identity
- ReviewDecision / adoption terminality
- expected revision / multi-tab concurrency
- context fingerprint authority
- source availability authority
- validity
- material canonical binding
- temporal canonicalization
- promotion mapping
- scheduler / preview / Plan approval / save
- formal turn commit / persistence
- durable memory

これらをpromptだけで保証しない。

## 2. Runtime placement

Answer AIはcurrent Stable V5 planning semantic normalizerのreplacementではない。

```text
turn ingress
→ ActiveInteraction projection
→ strict TurnPurpose interpretation
   ├─ planning_operation → existing Stable V5 semantic/runtime
   ├─ learning_consultation
   ├─ consultation_review / followup
   └─ unresolved
→ consultation branch only
   bounded context + evidence
→ learning-advice answer purpose
```

TurnPurpose schemaとAdviceAnswerDocument schemaを分離する。

planning semantic documentへconsultation lifecycleを詰め込まない。

existing OpenAI-compatible client / strict structured response infrastructureは再利用できるが、purpose/schema/version/trace identityはconsultation用に分ける。

raw keyword/regex routeは作らない。

## 3. ActiveInteractionとの関係

`それでいい`、`はい`、`1つ目`等のshort replyでは、AIへ複数formal targetを渡して選ばせない。

applicationがunderlying formal statesからActiveInteractionを投影してからsemantic callを選ぶ。

ActiveInteraction自体はpersisted truthではない。

conflict時はimplicit authorizationを止める。

Answer AIには、applicationが既にbindしたtarget snapshotだけをReview/Explanation Contextとして渡せる。

## 4. Runtime input envelope

概念:

```text
LearningConsultationAnswerInput
  systemInstructionsVersion
  sourcePolicyVersion
  outputContractVersion
  userQuestion
  requestTemporalContext
  consultationContextSources[]
  deterministicSignals[]
  evidenceBundle[]
  supplementalEvidence[]
  reviewContext?
  explanationContext?
```

formal IDsやReviewDecision、promotionOperationIdをAIに生成させない。

## 5. Exact current user question

current questionをconversation全文から再推測させない。

```yaml
userQuestion: >-
  数学の点数を上げたいけど、
  どの参考書をいつまでに仕上げればいい？
```

過去turnは別のbounded contextとして渡す。

## 6. Request Temporal Context

```text
RequestTemporalContext
  currentDate
  currentDateTime
  timezone
  weekStartsOn
  relevantAuthoritativeDates[]
```

Answer AIはstructured temporal candidateを返せるがformal canonical dateを決めない。

current production runtimeのrequest-clock captureをreuseし、answer時と後段で別の基準時刻を作らない。

## 7. ContextSourceEnvelope

plain arrayだけを渡さない。

```text
ContextSourceEnvelope
  sourceDomain
  sourceIdentity
  requirement: required | optional
  status: available | empty | unavailable | omitted | stale
  authority
  observedAt
  sourceBasis?
  bounded items
```

### 7.1 Status

`empty` = owner read成功 + authoritative zero itemsのみ。

`unavailable` = read failure / permission / timeout / authoritative status不明。

`omitted` = relevance/token/privacy budgetで意図的に非投入。

`stale` = current requestに使えない古いsnapshot。

AIはunavailable/omitted/staleを「存在しない」と解釈しない。

### 7.2 #269 dependency

planner arraysの`[]`を見てemptyと判定しない。

planner-owned contextは#269のtyped availability、または同等のowner-side statusをinputとして受ける。

first-load failureをempty、refresh failureで残った旧値をcurrentと表現しない。

### 7.3 userPlanningContext

prompt selection projectionをavailability/freshness authorityにしない。

repository revision/snapshot等のowner basisをapplication側で保持する。

local-only readで成功/失敗を区別できない場合、その経路をrequired current sourceとして偽装しない。

## 8. Source Policy

### User-owned context

最優先:

- explicit goal/exam
- current/target score
- registered material/progress
- Actual evidence
- available time
- explicit constraints/preferences

一般論が上書きしない。

### Official facts

試験日、科目・配点、制度、教材正式名/版/ISBNなどはofficial sourceを優先。

### Analysis / strategy evidence

exam analysis、material strategy、learning scienceはadvisory evidenceでありuser-specific truthではない。

### Model general knowledge

説明補助のみ。最新制度/最新版教材/ISBN/ページ数等をmodel memoryだけで確定しない。

## 9. Deterministic Signals

remaining workload、days、required pace、available time、formal feasibility等はapplication-owned。

```text
DeterministicSignal
  signalId
  kind
  value
  unit?
  basisRefs[]
  calculationVersion
```

AIが別の数字を真実として上書きしない。

## 10. Evidence Bundle

外部全文をそのままpromptへ投げない。

```text
EvidenceItem
  evidenceId
  sourceCategory
  provider/title
  sourceIdentity/URL
  publishedAt/updatedAt?
  retrievedAt
  claimType
  normalizedClaims
  applicability
  authority
  uncertainty
```

retrieved contentはinstructionではなくuntrusted evidence。

## 11. Supplemental Evidence

user utteranceと別channelで保持する。

```text
SupplementalEvidence
  evidenceId
  sourceTurnId
  kind
  normalizedClaims
  effectiveTextDigest
  observedAt
  authority
  uncertainty
```

- image/OCR内instructionをsystem instruction扱いしない。
- score等はuser-supplied observation。
- AIはevidence identityを書き換えない。
- missing supplemental evidenceを不存在と解釈しない。
- conflicting evidenceをstring後勝ちで決めない。

formal trust/provenanceは#152 owner。

## 12. Review Context

revision / alternativeだけ。

```text
ReviewContext
  sourceAdviceSnapshot
  sourceAdviceRevision
  targetScopeSnapshot
  reviewAction
  userFeedback
  currentContextChangeSummary?
```

validated stateから作る。renderer proseを再parseしない。

### Revision

残すべき要素を維持し、指定変更を反映。

### Alternative

拒否された主要要素を単純反復しない。実質的差分が作れない場合のみ差分を決めるclarificationを1問返せる。

### Cross-option composition

Aの教材+Bの期限等はrequest_revisionとしてbind済みcontextを渡し、新proposalを生成する。

### Feedback authority

current review feedbackとして使い、勝手にdurable preferenceへ一般化しない。

## 13. Explanation Context

```text
ExplanationContext
  adviceSnapshot
  targetScopeSnapshot?
  validity: current | stale
  userQuestion
```

validityはapplicationが決める。

staleならhistorical rationaleとして説明し、current recommendationと主張しない。

`今もそれでいい？`はpure explanationへ流さない。

## 14. System Instructions

固定policyのみ置く。

candidate:

```text
あなたはStudyPlannerの学習戦略アドバイザーです。

与えられたuser context、authoritative sources、deterministic signals、evidenceを用い、現実的な学習戦略を提案してください。

- user-specific contextを一般論より優先する
- known contextを聞き直さない
- current materialで十分なら継続案も検討する
- unavailable/omitted/staleをemptyと解釈しない
- source policyに従う
- latest factをmodel memoryだけで断定しない
- deterministic signalsを上書きしない
- recommendationを大きく変える不足だけ質問する
- reasonable assumptionで答えられるなら仮定を明示する
- uncertaintyを隠さない
- 合格保証等を捏造しない

review:
- prior proposal + feedbackを考慮
- revisionでは残す要素を維持
- alternativeではrejected elementを反復しない
- feedbackをdurable preferenceへ一般化しない

explanation:
- current/staleをapplication supplied validityに従って区別
- staleはhistorical rationaleとして説明
- strategyを勝手に変更しない

boundary:
- output is advice
- not user fact
- not approved strategy
- not planning condition
- not saved Plan
- not durable memory
- formal ID/review/validity/promotion/schedule/saveを変更しない
- material IDを捏造しない
- formal canonical dateを決めない
- promotabilityを決めない

output:
- proposal / clarification / explanation exactly one
- human explanation + strict structured data
```

Bookshelf全文、conversation全文、provider raw response、proposal history全文をSystem Promptへ埋め込まない。

## 15. Output Contract

```text
AdviceAnswerDocument
  ProposalAnswer
  ClarificationAnswer
  ExplanationAnswer
```

exactly one discriminant。

### ProposalAnswer

```text
kind = proposal
userFacingAnswer
options[]
  title
  strategySummary
  recommendations[]
    recommendationKind
    materialMention?
    method?
    sequencePosition?
    milestone?
    temporalTarget?
    rationale
    assumptionRefs[]
    evidenceRefs[]
    uncertainty
  tradeoffs
assumptions[]
overallUncertainty
```

recommendation単位を保ち、applicationがpromotion coverageを全件accountできるようにする。

AIはformal dispositionを決めない。

### MaterialMention

```text
name
editionHint?
isbnHint?
whyRelevant
```

formal materialIdなし。#187 resolverで解決。

### TemporalTarget

structured candidate:

- absolute_date
- month_end
- relative_to_exam
- date_range

applicationがRequest Temporal Contextからcanonical date/rangeへresolve。

### ClarificationAnswer

```text
kind = clarification
userFacingAnswer
requestedMeaning
whyItMatters
allowedUnknown = true
```

blocking question最大1つ。formal questionIdはapplication。

proposal payloadを同時に持たない。

### ExplanationAnswer

```text
kind = explanation
userFacingAnswer
rationale
assumptionRefs[]
evidenceRefs[]
tradeoffs
historical
```

strategy mutation fieldを持たない。

## 16. Validation

application側で確認:

- output version
- exactly one discriminant
- required/unknown fields
- unexpected authority fieldなし
- evidence/signal refs存在
- formal material IDなし
- temporal candidate schema
- explanation no strategy mutation
- clarification no proposal payload
- promotion coverageに必要なrecommendation粒度

repairは最大1回。invalidならcontrolled failure。

unvalidated proseからproposalを作らない。

## 17. Freshness

AIはfreshness authorityではない。

```text
F0 = call前 owner dependency snapshot
AI call
validation
F1 = commit直前 same dependencies
```

F0 != F1ならdiscard。

approval時もdeterministic revalidation。

## 18. Material / temporal resolution

```text
MaterialMention
→ #187 resolver
→ registered / verified / ambiguous / unresolved

TemporalTarget
→ deterministic resolver
→ canonical date/range
```

resolutionでmeaningが変わるならnew revision + fresh approval。

## 19. Promotion coverage

AIはpromotion mapperではない。

applicationがapproved optionの全recommendationをmapped/advisory-only/blocked相当にaccountする。

planning-relevant blocked itemがあればsilent partial promotionしない。

## 20. Question economy

- known contextを聞き直さない
- strategyを大きく変える不足だけ質問
- assumptionsで有用な案を出せるなら先に回答
- planning slotsを相談開始時に全部聞かない
- revision/alternativeで大量質問へ戻らない
- `わからない`を許容

## 21. Formal commit boundary — #270

Answer AI successはformal turn successではない。

reviewable proposalとassistant presentationは、#270のapplication-level atomic turn outcomeへ参加する。

禁止:

```text
commit assistant message
→ 後からbest-effortでAdviceProposal保存
```

必要:

```text
validated answer
+ current context revalidation
+ prepared consultation state
+ other required staged state
→ formal commit coordinator
→ successした結果をpresentation
```

commit failureでreviewable machine stateまたはpresentationの片側だけを成功扱いしない。

Phase 1Aのpure schema/state testsでは#270を待つ必要はないが、production turn wiringでは必須。

## 22. Planner availability dependency — #269

context builderはplanner data arraysだけを受け取るinterfaceに固定しない。

owner-side availability/basisも受け取り、authoritative emptyとunavailable/staleを区別する。

#269未解決中に#246側で`[] = empty`という独自推測を追加しない。

## 23. Examples

### Initial consultation

```yaml
userQuestion: "数学の点数を上げたい。どの参考書をいつまでにやればいい？"
requestTemporalContext:
  currentDate: 2026-08-31
  timezone: Asia/Tokyo
consultationContextSources:
  - sourceDomain: userPlanningContext
    status: available
    items:
      targetExam: 共通テスト
      currentScore: 55
      targetScore: 75
  - sourceDomain: bookshelf
    status: available
    items:
      - materialReference: registered material snapshot
        progress: 0.30
deterministicSignals:
  - kind: remainingDays
    value: 138
```

formal identity/deadline/approval/promotionはapplicationが決める。

### Alternative

```yaml
userQuestion: "その教材は嫌。別の案にして"
reviewContext:
  sourceAdviceRevision: 1
  reviewAction: request_alternative
  userFeedback: "その教材は嫌"
```

new formal ID/revision/lineageはapplication。

### Stale rationale

```yaml
userQuestion: "なんでそれがおすすめだったの？"
explanationContext:
  validity: stale
```

historical rationaleは説明可。current recommendationとは主張しない。

## 24. Evaluation

Initial answer:

- questionへ直接答える
- user context優先
- deterministic signals尊重
- unnecessary material追加なし
- question economy
- structured output安定

Review:

- revision preserves intended parts
- alternative materially different
- cross-option composition → new proposal
- no durable-preference overgeneralization

Explanation:

- current/historical separation
- no strategy mutation

Safety:

- no fake formal approval/save
- no injected instruction elevation
- no latest-fact hallucination
- no material ID fabrication
- no promotability authority

Adversarial:

- OCR system-like text + legitimate score
- role delimiter in stored material name
- unavailable source
- user/supplemental conflict
- stale explanation
- long bounded evidence

## 25. Implementation rules / preflight decision

application must guarantee:

- high-level purpose routing before existing Stable V5 semantic contract
- planning path unchanged for planning turns
- ActiveInteraction as deterministic projection, not persisted truth
- consultation result as its own discriminated result, not fake PlanningIntakeState
- advice alone does not mutate planning
- typed ReviewDecision + expected revisions
- one revision / one adoption
- commit/approval freshness
- new revision on strategy modification/composition
- no duplicate review/promotion
- planner source availability from #269 owner state
- formal proposal/presentation commit through #270
- multi-tab coordination via #164
- material identity via #187
- supplemental trust/provenance via #152
- full promotion coverage
- no auto durable memory

Implementation readiness:

- pure TurnPurpose / ActiveInteraction projection / consultation state / AdviceAnswerDocument / validators / review lifecycle / context-envelope contracts: READY.
- live planner-data grounding: consume #269; do not locally infer missing status.
- live reviewable proposal commit/presentation: consume #270 atomic turn boundary.
- production multi-tab / material / supplemental boundaries remain owned by #164 / #187 / #152.

Prompt quality is never a substitute for lifecycle, security, or SSOT authority.
