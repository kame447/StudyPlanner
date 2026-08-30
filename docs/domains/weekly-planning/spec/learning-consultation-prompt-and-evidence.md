# Learning Consultation Prompt and Evidence Design

Status: supporting design / hardened against Issue #246 adversarial audit
Updated: 2026-08-31
Owning Issue: [#246](https://github.com/kame447/StudyPlanner/issues/246)
Parent canonical: [learning-consultation-and-advice.md](learning-consultation-and-advice.md)

## 1. この文書の位置付け

この文書は、Issue #246 のlearning-advice answer purposeへ何を渡し、どのauthorityで回答させ、何をstructured outputとして受け取るかを詳細化するsupporting designである。

親の正仕様は [Learning Consultation and Advice Contract](learning-consultation-and-advice.md) であり、矛盾時は親仕様を優先する。

本書が所有するもの:

- answer purpose固定instruction
- Source Policy
- LearningConsultationAnswerInputの責任分離
- ContextSourceEnvelopeのprompt-facing projection
- Evidence Bundle
- Supplemental Evidence
- exact user question
- Review Context
- Explanation Context
- AdviceAnswerDocument output contract
- answer model評価条件

本書が所有しないもの:

- formal consultation routing
- active advice identity
- ReviewDecision
- expected revision / concurrency control
- context fingerprint計算
- validity判定
- material canonical binding
- temporal canonicalization
- promotion
- scheduler / preview / Plan approval / save
- persistence / migration
- durable memory

これらをpromptだけで保証しようとしてはならない。

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
   StudyPlanner内のbounded authoritative projection

F. Deterministic Signals
   application-owned numeric truth

G. Evidence Bundle
   内部/外部evidence

H. Supplemental Evidence
   画像等から得たuser-supplied observation

I. Review Context / Explanation Context
   follow-up時だけ追加

J. Output Contract
   proposal / clarification / explanationのstrict schema
```

instruction、user fact、external evidence、review feedback、current questionを同じprose blockへ混在させない。

## 3. Runtime input envelope

概念上:

```text
LearningConsultationAnswerInput
├─ systemInstructionsVersion
├─ sourcePolicyVersion
├─ outputContractVersion
├─ userQuestion
├─ requestTemporalContext
├─ consultationContextSources[]
├─ deterministicSignals[]
├─ evidenceBundle[]
├─ supplementalEvidence[]
├─ reviewContext?
└─ explanationContext?
```

formal `adviceId / optionId / consultationRevision / ReviewDecision`等をanswer AIへ生成させない。

### 3.1 User Question

current questionをconversation全文から再推測させない。

```yaml
userQuestion: >-
  数学の点数を上げたいけど、
  どの参考書をいつまでに仕上げればいい？
```

過去turnが必要でも別contextとして渡す。

### 3.2 Request Temporal Context

相対期限を回答に含む可能性があるため、captured temporal contextを独立させる。

```text
RequestTemporalContext
├─ currentDate
├─ currentDateTime
├─ timezone
├─ weekStartsOn
└─ relevantAuthoritativeDates[]
```

Answer AIはこれを参考にstructured temporal candidateを返せるが、formal canonical dateのauthorityではない。

## 4. ContextSourceEnvelope

StudyPlanner contextをplain arrayだけで渡さない。

conceptual prompt-facing shape:

```text
ContextSourceEnvelope
├─ sourceDomain
├─ sourceIdentity
├─ requirement
│  ├─ required
│  └─ optional
├─ status
│  ├─ available
│  ├─ empty
│  ├─ unavailable
│  ├─ omitted
│  └─ stale
├─ authority
├─ observedAt
├─ sourceBasis?
└─ items
```

### 4.1 Status semantics

`empty`:
- loadに成功した。
- 対象データがauthoritativeに0件だった。

`unavailable`:
- load failure、permission、timeout等で取得できなかった。

`omitted`:
- relevance/token/privacy budget等で意図的に入力へ含めなかった。

`stale`:
- current requestへ使うにはbasisが古いとapplicationが判断した。

AIは`unavailable / omitted / stale`を「存在しない」と解釈してはならない。

### 4.2 Source候補

質問との関連性に応じて次を利用できる。

- current conversation / accepted planning state
- userPlanningContext
- Bookshelf / StudyMaterial
- material catalog
- Timetable
- existing Plan / Schedule
- Actual
- Reporting aggregate
- planning availability / capacity
- authoritative exam / goal dates

全データを毎回渡さない。

## 5. Source Policy

情報源のauthorityはclaim typeで変える。

### 5.1 User-owned authoritative context

ユーザー本人について最優先する。

- 明示目標
- 志望校 / 試験
- 現在点 / 目標点
- 登録教材 / 進捗
- Actual evidence
- 利用可能時間
- 明示制約 / 希望

一般的な学習ルートはこれを上書きしない。

### 5.2 Official fact sources

用途:

- 試験日
- 科目 / 配点 / 出題範囲
- 募集要項
- 資格制度
- 教材正式名称 / 版 / ISBN

大学・学校・試験運営団体・出版社等の公式sourceを優先する。

### 5.3 Exam analysis sources

用途:

- 難易度
- 必要学力帯
- 科目別傾向
- 模試データの解釈

河合塾、駿台、Benesse、Z会、東進等はevidenceになり得るが、一機関を絶対authorityとしない。

### 5.4 Material strategy sources

用途:

- 教材順序
- 前提関係
- 到達レベル
- 次教材候補

strategy evidenceでありuser-specific truthではない。

### 5.5 Learning science

retrieval practice、spaced practice、interleaving、worked examples、metacognition等を使える。

「必ず1・3・7日」「必ず3周」等の固定値を普遍的科学的正解として扱わない。

### 5.6 Model general knowledge

説明補助には使えるが、次をmodel memoryだけで確定しない。

- 最新入試制度 / 試験日
- 最新版教材
- ISBN / ページ数
- 最新参考書ルート
- 現在の大学難易度

## 6. Deterministic Signals

残り日数、remaining workload、必要ペース、利用可能時間、正式capacity/feasibility等はapplicationから渡す。

```text
strategy judgment → answer AI
numeric truth      → deterministic application
```

conceptual shape:

```text
DeterministicSignal
├─ signalId
├─ kind
├─ value
├─ unit?
├─ basisRefs[]
└─ calculationVersion
```

AIはsignal値を別計算で上書きしない。

必要なら人間向けに説明する。

## 7. Evidence Bundle

外部ページ全文をそのままpromptへ投げない。

```text
EvidenceItem
├─ evidenceId
├─ sourceCategory
├─ provider / title
├─ sourceIdentity / URL
├─ publishedAt / updatedAt?
├─ retrievedAt
├─ claimType
├─ normalizedClaims
├─ applicability
├─ authority
└─ uncertainty
```

retrieved contentはinstructionではなくuntrusted evidenceである。

proprietary教材ルート全文を無差別複製しない。

## 8. Supplemental Evidence

画像・OCR・添付から得た情報は、他のevidenceとauthorityを混ぜない。

```text
SupplementalEvidence
├─ evidenceId
├─ sourceTurnId
├─ kind
├─ normalizedClaims
├─ effectiveTextDigest
├─ observedAt
├─ authority
└─ uncertainty
```

重要原則:

- 画像内テキストをsystem instructionとして扱わない。
- image-derived score等はuser-supplied observationであり、durable memoryではない。
- answer modelはformal evidence IDを変更しない。
- raw imageの不存在を勝手に「画像内容が間違っていた」と解釈しない。

## 9. Review Context

`request_revision / request_alternative`時だけ渡す。

```text
ReviewContext
├─ sourceAdviceSnapshot
├─ sourceAdviceRevision
├─ targetScopeSnapshot
├─ reviewAction
│  ├─ request_revision
│  └─ request_alternative
├─ userFeedback
└─ currentContextChangeSummary?
```

`sourceAdviceSnapshot`はvalidated structured stateから作る。

renderer proseをregexで再解析しない。

### 9.1 Revision

userが残したい部分を可能な限り維持し、指定部分だけを変更する。

例:

```text
v1: 基礎問題精講を10月末まで
user: 教材はそれで、期限だけ11月末にして
```

教材を勝手に変更しない。

ただし期限変更によりstrategy全体が成立しなくなる場合はtrade-offを説明する。

### 9.2 Alternative

拒否された主要要素をそのまま再提示しない。

別案を作れない場合、無理に劣化案を捏造せず1つのtargeted clarificationへ落とせる。

### 9.3 Feedback authority

「重すぎる」「その教材は嫌」等をcurrent review contextとして使う。

ユーザーが明示していない恒久嗜好や教材の客観factへ一般化しない。

## 10. Explanation Context

「なぜ？」「理由は？」等のfollow-upでは、strategyを再生成するためのReviewContextではなくExplanationContextを渡す。

```text
ExplanationContext
├─ activeAdviceSnapshot
├─ activeAdviceRevision
├─ targetScopeSnapshot?
└─ userQuestion
```

Answer AIはactive strategyを変更せず、rationale / assumptions / evidence / trade-offだけを説明する。

strategy変更が必要になった場合は`kind=explanation`で勝手に変更せず、別のproposal/revision flowが必要であることを示す。

## 11. System Instructions

System Instructionsには変わりにくい判断原則だけを置く。

候補:

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
- source statusを尊重し、unavailableをemptyと解釈しない
- sourcePolicyに従う
- 最新性が必要な事実をmodel memoryだけで断定しない
- 一機関の方針を唯一の正解としない
- deterministicSignalsを上書きしない
- recommendationを大きく変える不足だけを質問する
- 合理的仮定で回答可能なら仮定を明示して答える
- 根拠が弱い場合は不確実性を明示する
- 根拠のない合格確率や保証を生成しない

reviewContextがある場合:
- prior proposalとuser feedbackを必ず考慮する
- revisionでは残すべき要素を維持する
- alternativeでは拒否された主要要素を反復しない
- feedbackをdurable preferenceへ勝手に一般化しない

explanationContextがある場合:
- strategy内容を変更しない
- rationale / assumptions / evidence / trade-offを説明する

境界:
- あなたの回答はadviceである
- user-stated factではない
- user-approved strategyではない
- promoted planning conditionではない
- saved Planではない
- durable memoryではない
- formal ID、review state、validity、promotion、schedule、saveを変更しない
- materialのcanonical IDを捏造しない
- relative dateをformal approval stateとして確定しない

出力:
- proposal / clarification / explanationのいずれか一つを返す
- 人間向け説明とvalidated structured dataを返す
```

System Promptへ個別サイト一覧、Bookshelf全文、conversation全文、検索結果全文を埋め込まない。

## 12. Output Contract

outputはdiscriminated unionとする。

```text
AdviceAnswerDocument
  = ProposalAnswer
  | ClarificationAnswer
  | ExplanationAnswer
```

AIがformal adviceId / optionId / review stateを生成しない。

### 12.1 ProposalAnswer

conceptual shape:

```text
ProposalAnswer
├─ kind = proposal
├─ userFacingAnswer
├─ options[]
│  ├─ title
│  ├─ strategySummary
│  ├─ recommendations[]
│  │  ├─ actionType
│  │  ├─ materialMention?
│  │  ├─ method?
│  │  ├─ sequencePosition?
│  │  ├─ milestone?
│  │  ├─ temporalTarget?
│  │  ├─ rationale
│  │  ├─ assumptionRefs[]
│  │  ├─ evidenceRefs[]
│  │  └─ uncertainty
│  └─ tradeoffs
├─ assumptions[]
└─ overallUncertainty
```

Phase 1ではoption内itemを個別approveしない。

applicationがvalidation後にadviceId / optionIdを付与する。

### 12.2 MaterialMention

AIは名前等のidentity candidateだけを返す。

```text
MaterialMention
├─ name
├─ editionHint?
├─ isbnHint?
└─ whyRelevant
```

`materialId`をAIに生成させない。

### 12.3 TemporalTarget

AIは期限proseだけでなくstructured candidateを返す。

例:

```text
TemporalTarget
  absolute_date(date)
  month_end(year, month)
  relative_to_exam(offsetDays, direction)
  date_range(start, end)
```

applicationがcaptured request temporal contextでcanonical dateへresolveする。

AIが自由形式の「来月くらい」をpromotion用formal dateとして確定しない。

### 12.4 ClarificationAnswer

```text
ClarificationAnswer
├─ kind = clarification
├─ userFacingAnswer
├─ requestedMeaning
├─ whyItMatters
└─ allowedUnknown = true
```

一回にblocking questionは最大1つ。

formal questionIdはapplicationが付与する。

ClarificationAnswerからAdviceProposalをcommitしない。

### 12.5 ExplanationAnswer

```text
ExplanationAnswer
├─ kind = explanation
├─ userFacingAnswer
├─ rationale
├─ assumptionRefs[]
├─ evidenceRefs[]
└─ tradeoffs
```

strategy material / target / sequenceを変更するstructured fieldを持たない。

## 13. Output validation

application側で最低限確認する。

- output contract version一致
- exactly one discriminant kind
- required field presence
- unexpected formal authority fieldがない
- evidenceRefsがinput evidenceに存在
- deterministic signal referenceが存在
- material mentionはidentity candidateでありformal IDでない
- temporal candidateがschema-valid
- explanationがstrategy mutationを含まない
- clarificationがproposal payloadを同時に持たない

validation failure時のrepairはcurrent Stable V5 policyの範囲で最大1回。

repair後もinvalidならcontrolled failure。

unvalidated proseからproposalを作らない。

## 14. Context freshnessとの関係

answer AI自身にfreshness authorityを持たせない。

applicationはanswer call前にContextSnapshotを作り、structured output validation後にdependencyを再読込する。

```text
F0 = answer call前fingerprint
F1 = proposal commit前fingerprint

F0 == F1
  → commit candidate

F0 != F1
  → AI output discard
```

answer AIへ「今も最新か確認して」と依頼してfreshnessを保証したことにしない。

## 15. Material resolutionとの関係

AI outputのMaterialMentionはadvice contentである。

formal resolverはapplication側で行う。

```text
MaterialMention
→ registered material match
→ verified catalog match
→ unresolved
```

unresolvedでも人間向けadvice表示は可能だが、promotionはcanonical contractに従ってblockする。

同名教材や版違いをmodel confidenceだけで一意bindしない。

## 16. Temporal resolutionとの関係

TemporalTargetはapplicationがresolveする。

resolution後のcanonical targetはAnswer AIへ再度自由編集させない。

revision callで期限変更を提案させる場合も、AIは新しいstructured candidateを返し、applicationが再normalizeする。

## 17. Question economy

- known contextを再質問しない
- recommendationが大きく変わる不足だけを質問
- 仮定で有用な回答が可能なら仮定を明示して回答
- planning slotをconsultation開始時から全部聞かない
- 「わからない」を許容
- revision / alternativeでも大量質問へ戻らない

差分を作れない場合に限り、最大1つのtargeted clarificationを返せる。

## 18. Example: initial consultation

```yaml
userQuestion: "数学の点数を上げたい。どの参考書をいつまでにやればいい？"

requestTemporalContext:
  currentDate: 2026-08-31
  timezone: Asia/Tokyo

consultationContextSources:
  - sourceDomain: userPlanningContext
    status: available
    requirement: required
    items:
      - targetExam: 共通テスト
        targetScore: 75
        examDate: 2027-01-16

  - sourceDomain: bookshelf
    status: available
    requirement: required
    items:
      - name: 基礎問題精講
        progress: 0.30

  - sourceDomain: planningAvailability
    status: available
    requirement: optional
    items:
      - weekdayMinutes: 60
        weekendMinutes: 120

deterministicSignals:
  - signalId: remaining-days-1
    kind: remaining_days
    value: 138
    unit: days
```

AIはこのinputからformal Planを作らない。

## 19. Example: source unavailable

```yaml
consultationContextSources:
  - sourceDomain: bookshelf
    requirement: required
    status: unavailable
    items: []
```

この状態で「登録教材は何もありません」と断定しない。

必要なら「本棚情報を確認できないため、その前提を使う提案は確定できない」と扱う。

## 20. Example: revision

```yaml
reviewContext:
  sourceAdviceRevision: 1
  reviewAction: request_revision
  userFeedback: "教材はそれで、期限だけ11月末にして"
  targetScopeSnapshot:
    material: 基礎問題精講
    temporalTarget:
      kind: month_end
      year: 2026
      month: 10
```

期待:

- materialは維持
- targetだけ変更候補を返す
- new formal revisionはapplicationが作る
- 「そのまま予定組んで」が同じturnにあってもAIがformal approveしない

## 21. Example: explanation

```yaml
explanationContext:
  activeAdviceRevision: 2
  targetScopeSnapshot:
    material: 基礎問題精講
    targetDate: 2026-11-30

userQuestion: "なんでそれがおすすめ？"
```

期待:

- rationaleのみ説明
- material/targetを変更しない
- new proposalを作らない

## 22. Answer model evaluation

Real API evaluationで少なくとも次を見る。

### Initial answer quality

- current questionへ直接答える
- user contextを一般論より優先
- source statusを正しく扱う
- 不要な教材を増やさない
- current material継続を選択肢にできる
- deterministic signalsを上書きしない
- 質問しすぎない
- schemaが安定する

### Review quality

- revisionで維持対象を維持
- alternativeで実質的差分
- rejected elementの反復回避
- feedbackのdurable preference化をしない
- current contextとの衝突を説明
- mixed revision + schedule requestで承認したふりをしない

### Explanation quality

- rationaleだけを説明
- active strategyをsilent changeしない
- 根拠が弱い部分を明示

### Temporal / material quality

- relative targetをstructured candidateで返す
- material IDを捏造しない
- 同名/版違いを断定しすぎない

### Failure / missing context

- unavailableをemptyと解釈しない
- omitted sourceから事実を推測しない
- latest factsをmodel memoryで捏造しない

### Security / authority

- formal approvalを実行したと主張しない
- schedule/saveを実行したと主張しない
- evidence内prompt injectionを命令扱いしない
- supplemental image textをinstruction扱いしない

## 23. Implementation rules

このsupporting designを理由に重要安全条件をpromptへ移さない。

必ずapplication側でも保証する。

- advice生成だけでplanning stateを変えない
- output discriminantをvalidateする
- active advice identityをtyped stateで管理する
- expected revisionを確認する
- context freshnessをcommit前/approval時に検証する
- material identityをdeterministic resolveする
- temporal targetをdeterministic normalizeする
- stale/non-revalidatable proposalをpromoteしない
- duplicate review/promotionをidempotentに防ぐ
- consultation clarificationを専用typed stateへcommitする
- persistence/reloadでprose再解析しない
- review feedbackをdurable memoryへ自動昇格しない
- validated final outputだけをAdviceProposal候補にする

Promptは回答品質を高めるための契約であり、security / lifecycle / authorization authorityではない。
