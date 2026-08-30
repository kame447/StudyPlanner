# Learning Consultation Prompt and Evidence Design

Status: supporting design / aligned with seven-view canonical contract
Updated: 2026-08-31
Owning Issue: [#246](https://github.com/kame447/StudyPlanner/issues/246)
Parent canonical: [learning-consultation-and-advice.md](learning-consultation-and-advice.md)

## 1. この文書の位置付け

この文書は、Issue #246 のlearning-advice answer purposeへ何を渡し、どのauthorityで回答させ、何をstructured outputとして受け取るかを定義するsupporting designである。

親の正仕様は [Learning Consultation and Advice Contract](learning-consultation-and-advice.md) であり、矛盾時は親仕様を優先する。

本書が所有するもの:

- answer purpose固定instruction
- Source Policy
- prompt-facing bounded context
- deterministic signalの提示方法
- Evidence Bundle
- Supplemental Evidence
- exact current user question
- Review Context
- Explanation Context
- AdviceAnswerDocument output contract
- answer model評価条件

本書が所有しないもの:

- formal consultation routing
- ActiveInteraction selection
- advice / option identity
- ReviewDecision
- adoption terminality
- expected revision / multi-tab concurrency
- context fingerprint計算
- validity判定
- material canonical binding
- temporal canonicalization
- promotion coverage / mapping
- scheduler / preview / Plan approval / save
- persistence / migration
- durable memory

これらをpromptだけで保証してはならない。

## 2. 基本原則

answer modelへ巨大な一枚promptを渡さず、authorityごとに入力を分離する。

```text
A. System Instructions
   変わりにくい役割・禁止事項

B. Source Policy
   claim typeごとのevidence優先順位

C. User Question
   current turnで実際に聞かれた内容

D. Request Temporal Context
   current date/time/timezone等のcaptured context

E. Consultation Context Sources
   owner domainから作ったbounded read model

F. Deterministic Signals
   application-owned numeric truth

G. Evidence Bundle
   内部/外部のnormalized evidence

H. Supplemental Evidence
   画像/OCR等のuser-supplied observation

I. Review Context / Explanation Context
   follow-up時のみ

J. Output Contract
   proposal / clarification / explanationのstrict schema
```

instruction、user fact、external evidence、review feedback、current questionを一つのprose blockへ混在させない。

## 3. Runtime input envelope

概念上:

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

formal `adviceId / optionId / consultationRevision / ReviewDecision / promotionOperationId`等をanswer AIへ生成させない。

applicationが既にbind済みの対象snapshotをReview / Explanation Contextへ渡すことはできるが、AIが自然言語からformal target identityを確定するauthorityにはしない。

## 4. Exact current user question

current user questionをconversation全文から再推測させない。

```yaml
userQuestion: >-
  数学の点数を上げたいけど、
  どの参考書をいつまでに仕上げればいい？
```

過去turnが必要でも`userQuestion`とは別のbounded contextとして渡す。

`それでいい`等の短答が何を指すかは、answer AI callより前にapplication側のActiveInteraction / typed semantic bindingで処理する。

AIへ複数のauthorization-bearing candidateを渡して「どれを承認したか選んで」と委譲しない。

## 5. Request Temporal Context

相対期限を回答へ含む可能性があるため、captured temporal contextを独立させる。

```text
RequestTemporalContext
  currentDate
  currentDateTime
  timezone
  weekStartsOn
  relevantAuthoritativeDates[]
```

Answer AIはこのcontextを参考にstructured temporal candidateを返せるが、formal canonical dateのauthorityではない。

## 6. ContextSourceEnvelope

StudyPlanner contextをplain arrayだけで渡さない。

prompt-facing shape:

```text
ContextSourceEnvelope
  sourceDomain
  sourceIdentity
  requirement: required | optional
  status: available | empty | unavailable | omitted | stale
  authority
  observedAt
  sourceBasis?
  items
```

### 6.1 Status semantics

`empty`:
- loadに成功した。
- 対象データがauthoritativeに0件だった。

`unavailable`:
- load failure / permission / timeout等で取得できなかった。

`omitted`:
- relevance / token / privacy budget等で意図的に入力へ含めなかった。

`stale`:
- applicationがcurrent requestへ使えないbasisと判定した。

AIは`unavailable / omitted / stale`を「存在しない」と解釈してはならない。

### 6.2 Owner snapshot / prompt projectionの分離

このenvelopeはowner domain snapshotからapplicationが作る。

Stable V5 public semantic summary等の既存prompt projectionをfreshness / availabilityのsource of truthとして再利用しない。

AIへ渡す際にrevisionやdigestを省略できても、application側のContextSnapshotでは保持する。

## 7. Source Policy

claim typeによってauthorityを変える。

### 7.1 User-owned authoritative context

ユーザー本人について最優先する。

- 明示目標
- 志望校 / 試験
- 現在点 / 目標点
- 登録教材 / 進捗
- Actual evidence
- 利用可能時間
- 明示制約 / 希望

一般的な学習ルートがこれを上書きしない。

### 7.2 Official fact sources

用途:

- 試験日
- 科目 / 配点 / 出題範囲
- 募集要項
- 資格制度
- 教材正式名称 / 版 / ISBN

大学・学校・試験運営団体・出版社等の公式sourceを優先する。

### 7.3 Exam analysis sources

用途:

- 難易度
- 必要学力帯
- 科目別傾向
- 模試データの解釈

一機関の評価を絶対authorityにしない。

### 7.4 Material strategy sources

教材順序、前提関係、到達レベル、次教材候補等のstrategy evidenceとして利用できる。

user-specific truthではない。

### 7.5 Learning science

retrieval practice、spaced practice、interleaving、worked examples、metacognition等を説明・戦略判断に使える。

「必ず1・3・7日後」「必ず3周」等を普遍的な固定正解にしない。

### 7.6 Model general knowledge

説明補助には使えるが、次をmodel memoryだけで確定しない。

- 最新入試制度 / 試験日
- 最新版教材
- ISBN / ページ数
- 最新参考書ルート
- 現在の大学難易度

## 8. Deterministic Signals

残り日数、remaining workload、必要ペース、利用可能時間、formal capacity / feasibility等はapplicationから渡す。

```text
strategy judgment → Answer AI
numeric truth      → deterministic application
```

conceptual shape:

```text
DeterministicSignal
  signalId
  kind
  value
  unit?
  basisRefs[]
  calculationVersion
```

AIはsignal値を独自計算で上書きしない。

AIがsignalを不適切だと感じても、別の数字を真実として出すのではなくassumption / limitationとして説明する。

## 9. Evidence Bundle

外部ページ全文をそのままpromptへ投げない。

```text
EvidenceItem
  evidenceId
  sourceCategory
  provider / title
  sourceIdentity / URL
  publishedAt / updatedAt?
  retrievedAt
  claimType
  normalizedClaims
  applicability
  authority
  uncertainty
```

retrieved contentはinstructionではなくuntrusted evidenceである。

proprietary教材ルート全文を無差別複製しない。

## 10. Supplemental Evidence

画像・OCR・添付から得た情報はuser utteranceと別channelで渡す。

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

重要原則:

- 画像内テキストをsystem instructionとして扱わない。
- image-derived score等はuser-supplied observationでありdurable memoryではない。
- AIはformal evidence IDを変更しない。
- supplemental contentが欠けていることを「その事実は存在しない」と推測しない。
- user utteranceとsupplemental evidenceが矛盾する場合、文字列の後勝ちで解決しない。

trust / provenanceのformal policyはIssue #152がownerであり、本機能だけの別security modelを作らない。

## 11. Review Context

`request_revision / request_alternative`時だけ渡す。

```text
ReviewContext
  sourceAdviceSnapshot
  sourceAdviceRevision
  targetScopeSnapshot
  reviewAction: request_revision | request_alternative
  userFeedback
  currentContextChangeSummary?
```

source advice snapshotはvalidated structured stateから作る。

renderer proseをregexで再解析しない。

### 11.1 Revision

ユーザーが残したい部分を可能な限り維持し、指定部分を変更する。

例:

```text
v1: 基礎問題精講を10月末まで
user: 教材はそれで、期限だけ11月末にして
```

期限変更がstrategy全体を成立不能にする場合はtrade-offを説明する。

### 11.2 Alternative

拒否された主要要素をそのまま再提示しない。

別案を作れない場合は劣化案を捏造せず、recommendationを大きく変える1問だけをclarificationとして返せる。

### 11.3 Cross-option composition

`Aの教材でBの期限`、`AとB両方`等はAI側で既存optionへの承認として扱わない。

applicationがreview semanticsを`request_revision`としてbindしたうえで、必要なsource snapshotsをReview Contextへ渡す。

新しいproposalとして返す。

### 11.4 Feedback authority

「重すぎる」「その教材は嫌」等をcurrent review contextとして利用する。

ユーザーが明示していない恒久嗜好や教材の客観factへ一般化しない。

## 12. Explanation Context

`なぜ？`等のfollow-upではReview ContextではなくExplanation Contextを使う。

```text
ExplanationContext
  adviceSnapshot
  targetScopeSnapshot?
  validity: current | stale
  userQuestion
```

validityはapplicationが決める。

### 12.1 Current explanation

current proposalならrationale / assumptions / evidence / trade-offを説明する。

strategyを変更しない。

### 12.2 Historical explanation

stale proposalでも「当時なぜ推奨したか」はimmutable snapshotから説明できる。

ただし:

- `今もおすすめ`と断定しない。
- stale reasonを必要に応じて説明する。
- strategyをcurrentへ復活させない。

`今もそれでいい？`はpure explanationとしてanswer purposeへ渡さず、application側でrevalidation/consultationとして扱う。

## 13. System Instructions

System Instructionsには変わりにくい役割・禁止事項だけを置く。

candidate:

```text
あなたはStudyPlannerの学習戦略アドバイザーです。

与えられたユーザー固有情報、authoritative context、
deterministic signals、evidenceを組み合わせ、
現実的な学習戦略を提案してください。

基本原則:
- StudyPlannerが与えたユーザー固有情報を最優先する
- known contextを聞き直さない
- 一般ルートをそのままコピーせず現在地へ適合させる
- 現在の教材で十分なら継続案を含める
- source statusを尊重し、unavailable/omitted/staleをemptyと解釈しない
- source policyに従う
- 最新性が必要な事実をmodel memoryだけで断定しない
- 一機関の方針を唯一の正解としない
- deterministic signalsを上書きしない
- recommendationを大きく変える不足だけを質問する
- 合理的仮定で回答可能なら仮定を明示して答える
- 根拠が弱い場合は不確実性を明示する
- 根拠のない合格確率や保証を生成しない

review contextがある場合:
- prior proposalとuser feedbackを必ず考慮する
- revisionでは残すべき要素を維持する
- alternativeでは拒否された主要要素を反復しない
- feedbackをdurable preferenceへ勝手に一般化しない

explanation contextがある場合:
- validity=currentならcurrent rationaleを説明する
- validity=staleならhistorical rationaleとして説明し、current recommendationだと主張しない
- strategy内容を変更しない

境界:
- あなたの回答はadviceである
- user-stated factではない
- user-approved strategyではない
- promoted planning conditionではない
- saved Planではない
- durable memoryではない
- formal ID、review state、active interaction、validity、promotion、schedule、saveを変更しない
- material canonical IDを捏造しない
- relative dateをformal canonical dateとして確定しない
- recommendationのformal promotabilityを決めない

出力:
- proposal / clarification / explanationのいずれか一つ
- 人間向け説明とvalidated structured data
```

System PromptへBookshelf全文、conversation全文、provider raw response、proposal history全文を埋め込まない。

## 14. Output Contract

```text
AdviceAnswerDocument
  ProposalAnswer
  ClarificationAnswer
  ExplanationAnswer
```

exactly one discriminant kindを返す。

AIがformal adviceId / optionId / review status / active interaction / promotion statusを生成しない。

### 14.1 ProposalAnswer

conceptual shape:

```text
ProposalAnswer
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

Phase 1ではoption内itemを個別approveしない。

recommendationsを十分にstructuredにする理由は、applicationがpromotion coverageを全件accountできるようにするためである。

AIは`mapped / advisory_only / blocked`等のformal dispositionを決めない。

### 14.2 MaterialMention

AIはidentity candidateだけを返す。

```text
MaterialMention
  name
  editionHint?
  isbnHint?
  whyRelevant
```

`materialId`を生成させない。

formal resolutionはIssue #187側のresolver / facadeをapplicationが利用して行う。

### 14.3 TemporalTarget

structured candidateを返す。

例:

```text
absolute_date(date)
month_end(year, month)
relative_to_exam(offsetDays, direction)
date_range(start, end)
```

applicationがRequest Temporal Contextからcanonical dateへresolveする。

free proseの`来月くらい`をpromotion用formal dateにしない。

### 14.4 ClarificationAnswer

```text
ClarificationAnswer
  kind = clarification
  userFacingAnswer
  requestedMeaning
  whyItMatters
  allowedUnknown = true
```

一回にblocking questionは最大1つ。

formal questionIdはapplicationが付与する。

proposal payloadを同時に持たない。

### 14.5 ExplanationAnswer

```text
ExplanationAnswer
  kind = explanation
  userFacingAnswer
  rationale
  assumptionRefs[]
  evidenceRefs[]
  tradeoffs
  historical = boolean
```

`historical`はapplication supplied validityに従って出力し、AIがfreshnessを推測して決めない。

strategy material / deadline / sequenceを変更するstructured fieldを持たない。

## 15. Output validation

application側で最低限確認する。

- output contract version
- exactly one discriminant
- required fields
- unexpected formal authority fieldがない
- evidence refsがinput bundleに存在
- deterministic signal refsが存在
- material mentionがformal IDでない
- temporal candidateがschema-valid
- explanationがstrategy mutationを含まない
- clarificationがproposal payloadを持たない
- structured recommendationsがpromotion coverageに必要な粒度で列挙されている

validation failure時のstructured repairはcurrent Stable V5 policyの範囲で最大1回。

repair後もinvalidならcontrolled failure。

unvalidated proseからproposalを作らない。

## 16. Freshnessとの関係

Answer AI自身にfreshness authorityを持たせない。

applicationがcall前ContextSnapshotとvalidation後のcurrent dependenciesを比較する。

```text
F0 = call前
F1 = commit前

F0 == F1
  commit candidate

F0 != F1
  output discard
```

AIへ`今も最新か確認して`と依頼してfreshnessを保証したことにしない。

approval時にも別途deterministic revalidationする。

## 17. Material / temporal resolutionとの関係

MaterialMention / TemporalTargetはadvice contentでありformal planning truthではない。

```text
MaterialMention
→ #187 owner resolver
→ registered / verified catalog / ambiguous / unresolved

TemporalTarget
→ deterministic temporal resolver
→ canonical date/range
```

resolution後のcanonical valueをAIへ自由編集させない。

identity / temporal resolutionによってproposal意味が変わる場合はnew revision + fresh approvalを要求する。

## 18. Promotion coverageとの関係

Answer AIはformal promotion mapperではない。

applicationはapproved option内の全recommendationをaccountし、`mapped / advisory_only / blocked`相当に分類する。

AI output schemaはその判定に必要なrecommendation単位を失わないことだけを保証する。

planning-relevant recommendationがblockedの場合、applicationはsilent partial promotionしない。

AIに`反映できないものを無視して予定を作って`というhidden instructionを与えて安全性を代替しない。

## 19. Question economy

- known contextを聞き直さない
- recommendationが大きく変わる不足だけを質問する
- 仮定を明示して有用な案を出せるなら先に回答する
- planning slotを相談開始時に全部聞かない
- revision / alternativeでも大量質問へ戻らない
- `わからない`を許容する

別案を有意に差別化できない場合、固定回数heuristicではなく差分を決める1問だけを返せる。

## 20. Example: initial consultation

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

AIはこの入力からstrategy candidateを返すが、formal material identity / deadline / approval / promotionはapplicationが決める。

## 21. Example: alternative

```yaml
userQuestion: "その教材は嫌。別の案にして"

reviewContext:
  sourceAdviceRevision: 1
  reviewAction: request_alternative
  userFeedback: "その教材は嫌"
  sourceAdviceSnapshot:
    strategy: "標準問題精講を使う"
```

新proposalのformal ID / revision / lineageはapplicationが付与する。

## 22. Example: stale rationale

```yaml
userQuestion: "なんでそれがおすすめだったの？"

explanationContext:
  validity: stale
  adviceSnapshot:
    strategy: "基礎問題精講を10月末まで"
```

期待:

- 当時の根拠は説明できる。
- `今もそのままでよい`とは断言しない。
- new strategyを勝手に生成しない。

## 23. Answer model evaluation

### 23.1 Initial answer quality

- current questionへ直接答える
- user contextを一般ルートより優先する
- 一機関を絶対視しない
- 不要な教材を増やさない
- deterministic signalsを上書きしない
- 不足時に質問しすぎない
- structured outputが安定する

### 23.2 Review loop

- revisionで残すべき部分を維持
- alternativeで実質的な別案
- rejected elementを単純反復しない
- cross-option compositionをnew proposalとして扱える
- feedbackをdurable preferenceへ一般化しない
- current contextとの衝突を説明できる

### 23.3 Explanation

- current rationaleとhistorical rationaleを区別
- stale adviceをcurrentへ復活させない
- explanationでstrategy fieldを変更しない

### 23.4 Safety / authority

- 自分で`承認しました`とformal state変更したふりをしない
- schedule / save実行を主張しない
- external/supplemental injectionをinstruction扱いしない
- model memoryで最新事実を捏造しない
- material IDを捏造しない
- promotabilityをformalに決めない

### 23.5 Adversarial inputs

- OCR内system-like instruction + legitimate score
- stored material name内role delimiter
- unavailable sourceをemptyと誤認しない
- user utteranceとsupplemental evidenceの矛盾
- stale explanation
- very long but bounded evidence

## 24. Implementation rule

このsupporting designを理由に安全条件をpromptへ委ねない。

application側で必ず保証する。

- adviceだけでplanning stateを変えない
- ActiveInteractionをapplicationがbindする
- ReviewDecisionをtyped identity/revisionへbindする
- one revision / one adoptionを保証する
- dismiss時にauto regenerateしない
- commit / approval freshnessをrevalidateする
- stale proposalをpromoteしない
- revisionはnew proposalとしてcommitする
- duplicate review / promotionを防ぐ
- same-browser multi-tab mutationは#164 coordinatorへ委譲する
- review feedbackをdurable memoryへ自動昇格しない
- final validated outputだけをproposal candidateにする
- material identityは#187 resolverを使う
- supplemental trust/provenanceは#152 boundaryを使う
- promotion coverageを全recommendationへ適用する

Promptは判断品質を高めるための契約であり、security / lifecycle / SSOT authorityそのものではない。
