# Learning Consultation and Advice Contract

Status: canonical product requirement / pre-implementation hardening complete
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

対象は、既存条件から予定を生成するだけのturnではない。ユーザーが学習方針そのものを相談し、AIがgrounded adviceを返し、ユーザーがレビューした意思だけを既存Stable V5 planningへ安全に接続するturnを扱う。

代表例:

- 「数学の点数を上げたいけど、どの参考書をいつまでに仕上げればいい？」
- 「英語が苦手なんだけど、何から始めればいい？」
- 「この参考書が難しすぎるけど、変えた方がいい？」
- 「金フレが終わったら次に何をやればいい？」
- 「共通テスト数学を伸ばしたい。今の教材のままでいい？」
- 「この勉強法で間に合う？」
- 「なぜその教材がおすすめなの？」

production runtimeへこの機能が完全実装されるまでは [current-contract-v5.md](../architecture/current-contract-v5.md) がproduction baselineである。

本書では次の語を規範的に使う。

- 必須: 実装が満たさなければならない。
- 禁止: 実装してはならない。
- 推奨: 特別な理由がない限り従う。
- projection: 表示・集計・利便性のための派生状態。authorizationの正本ではない。

## 2. Product goal

同じAI計画の会話面で次を成立させる。

```text
相談する
→ StudyPlanner内の関連contextをboundedに取得
→ 学習方針・教材・順序・目安期限について助言を得る
→ 理由や代替案を聞く
→ proposalをレビューする
   ├─ approve
   ├─ request_revision
   ├─ request_alternative
   └─ dismiss
→ approve対象をcurrent contextで再検証
→ approved + current + promotableなscopeだけをStable V5へpromotion
→ readiness / scheduler
→ preview
→ Planの最終承認
→ save
```

最終的なproduct outcomeは「AIがそれらしい勉強法を話すこと」ではない。

ユーザーが、自分の目標・現在地・教材・予定・進捗にgroundされた提案を理解し、修正・別案・終了を含めて自分で判断し、その意思だけが安全にplanningへ反映されることを目的とする。

## 3. Non-negotiable invariants

最重要不変条件:

```text
AI-generated advice
≠ user-stated fact
≠ user-approved planning strategy
≠ promoted planning condition
≠ preview
≠ saved Plan
≠ durable memory
```

また、2種類の承認を混同しない。

```text
Advice approval
= この助言の特定scopeをplanning材料として使ってよい

Plan approval
= 実際に生成されたpreviewを保存してよい
```

AIが「基礎問題精講を10月末までに終えるのがおすすめ」と回答しただけでは、次のどれも成立しない。

- ユーザーがその教材を使うと決めた
- 10月末を正式期限として承認した
- schedulerへ渡してよい
- Planとして保存してよい
- 長期記憶として保持してよい

追加の必須不変条件:

1. renderer proseからmachine stateを再構成しない。
2. activeなproposal revision以外へreview commandを適用しない。
3. reviewとpromotionはimmutable operation identityとexpected revisionへbindする。
4. AI回答生成中に根拠が変わった結果をcurrent proposalとしてcommitしない。
5. reload後もreview対象・根拠・lineageをtyped stateから復元できる。
6. `empty / unavailable / omitted / stale / non_revalidatable`を同じ状態へ潰さない。
7. 相対期限は一度canonical valueへ解決し、promotion時にproseを再解釈しない。
8. unresolvedな教材名をcanonical material identityとして扱わない。
9. consultation clarificationとplanning clarificationを同じpending question stateへ混在させない。
10. 新しいproposalを生成したturnだけで、その新proposalを暗黙承認しない。

## 4. Product scope

### 4.1 対象

初期実装は、予定作成と意味的に接続できる学習相談を対象とする。

- 学習戦略
- 教材選択
- 教材遷移
- 目標分解
- 期限提案
- feasibility explanation
- 学習方法
- 比較
- 理由説明

### 4.2 初期非対象

- StudyPlannerと無関係な汎用雑談assistant化
- AI回答から直接Planを書き込むshortcut
- 教材・試験ごとの巨大な決定論的heuristic表
- 教材ランキングサービス
- Web全体を無制限に探索するautonomous research agent
- AI回答の自動長期記憶化
- Goal / Bookshelf / Timetable / Actual / Reportingのsource of truth複製
- cross-device consultation state同期
- offline multi-device conflict resolution
- item単位の部分承認

item単位の部分承認はPhase 2以降へ送る。Phase 1でreview可能なscopeは「proposal全体」または「複数optionのうち1つのoption全体」に限定する。

## 5. Ownership boundary

### 5.1 AI semantic layer

AIが所有する意味:

- current turnがconsultationか
- consultationの対象
- proposal / optionへのcontextual reference
- review actionの意味
  - `approve`
  - `request_revision`
  - `request_alternative`
  - `dismiss`
- revision / alternative feedbackの意味
- `今回は` / `今後も` 等のscope meaning
- consultation follow-upがrationale/explanation要求か
- recommendationに必要な曖昧さ

AIはformal ID、expected revision、review operation identity、promotion identityを決めない。

### 5.2 Deterministic application

applicationが所有するもの:

- consultation routeを実行可能状態として受理するか
- context source selection
- required / optional source classification
- source status / provenance / digest / revision
- context fingerprint
- advice / option / review decision / promotion operation identity
- active proposal revision
- lineage
- review binding
- stale / non-revalidatable判定
- review / promotion concurrency control
- promotion idempotency
- temporal normalization
- material identity resolution
- persistence / restore / migration
- planning Fact Graphへ入る正式構造
- readiness / scheduler / preview / Plan approval / save

### 5.3 Answer AI

Answer AIが所有するもの:

- grounded contextに基づく学習戦略・教材・順序・説明
- 複数案の比較・trade-off
- revision feedbackを踏まえた修正版
- alternative feedbackを踏まえた実質的な別案
- 必要な場合の最小限のtargeted clarification
- 不確実性・仮定の説明
- deterministic signalsの人間向け説明

Answer AIはformal review state、validity、promotion、scheduler placement、Plan approval、saveを所有しない。

## 6. Existing codeとの責任分離

### 6.1 `study_advice`を新機能のauthorityとして流用しない

current codeには互換語彙として `PlanningIntent = 'study_advice'` が存在する。

Issue #246では、これを新しいconsultation lifecycleのformal authorityとしてそのまま流用してはならない。

実装ではconceptとして少なくとも次を区別する。

```text
planning_operation
learning_consultation
consultation_review
consultation_followup
other / unresolved
```

exact TypeScript名は実装時に既存schemaへ合わせてよいが、意味責任の統合は禁止する。

### 6.2 既存LearningStrategyProposalとの分離

current Stable V5の `WeeklyPlanningLearningStrategyProposalRecord` は、週内capacityやmemorization session等を扱うplanning-side proposalである。

Issue #246の `AdviceProposal` は学習相談のadvisory stateであり、同じ型・ledger・statusを共有してはならない。

architecture testで両者の責任境界を固定する。

## 7. Turn routing and atomicity

### 7.1 `question`概念の衝突を避ける

```text
assistant clarification
  application → userへplanning不足情報を質問

consultation clarification
  learning consultation → userへ助言に必要な1問を質問

user consultation
  user → StudyPlannerへ学習相談
```

これらは別machine stateである。

### 7.2 Raw-text heuristic禁止

production semantic routingを教材名・科目・「おすすめ」等のkeyword/regexでauthority化しない。

raw text parserをsemantic fallbackとして追加しない。

### 7.3 Mixed turn

次のようなturnは複数意味を含む。

```text
「教材はそれで、期限だけ11月末にして、そのまま予定組んで」
```

Phase 1ではfail-safe ruleを固定する。

- active proposalの内容を変更する意味が含まれる場合、まず`request_revision`としてnew proposal revisionを生成する。
- 同じturnに「予定組んで」が含まれていてもnew revisionを自動approveしない。
- new revisionは必ず別の明示的review decisionを必要とする。
- 内容変更を含まない「それで予定組んで」はactive current proposalへの`approve`として扱える。

### 7.4 Rationale follow-up

「なんでそれがおすすめ？」等の説明要求は、active proposalの内容を変更しない限りnew proposal revisionを生成しない。

説明後の「それでいい」は、同じactive advice identityへbindできなければならない。

## 8. Answer output discriminant

Answer AIのvalidated outputは、Phase 1では必ず次のどれか一つに分類する。

```text
AdviceAnswerDocument
  ├─ kind = proposal
  ├─ kind = clarification
  └─ kind = explanation
```

一つのoutputを複数kindとして扱わない。

### 8.1 `proposal`

新しいreviewable AdviceProposal候補を生成する。

複数optionを返してよいが、Phase 1で一回のapproveが対象にできるのは1 scopeだけである。

### 8.2 `clarification`

blocking inputが1つある場合に返す。

clarification outputからAdviceProposalをcommitしない。

### 8.3 `explanation`

既存proposalのrationaleやtrade-offを説明する。

戦略内容を変更しない限り新revisionを作らない。

## 9. Consultation state model

consultation stateはFact Graphとは別のconversation-scoped advisory stateとして保持する。

概念モデル:

```text
ConsultationSessionState
├─ consultationId
├─ ownerId
├─ conversationId
├─ revision
├─ lifecycle
│  ├─ active
│  └─ closed
├─ activeAdviceId
├─ activeAdviceRevision
├─ proposals[]
├─ reviewDecisions[]
├─ validityChecks[]
├─ promotionReceipts[]
└─ pendingClarification?
```

`revision`はconsultation formal stateのcommitごとに単調増加する。

### 9.1 AdviceProposal

```text
AdviceProposal
├─ adviceId
├─ consultationId
├─ revision
├─ sourceQuestionTurnId
├─ supersedesAdviceId?
├─ supersededByAdviceId?
├─ options[]
├─ assumptions
├─ evidenceRefs
├─ dependencyRefs
├─ contextFingerprint
├─ temporalResolutions[]
├─ materialBindings[]
├─ createdAt
└─ answerSnapshot
```

proposalはimmutableに近い扱いとする。revisionでin-place mutationしない。

### 9.2 Active leaf invariant

review可能なのは、`ConsultationSessionState.activeAdviceId / activeAdviceRevision` が指すleaf revisionだけである。

new revisionをcommitした時点で旧revisionはhistoryとなり、次を禁止する。

- approve
- request_revision
- request_alternative
- dismissの対象として再利用
- promotion

古いUIボタン、別タブ、reload前のcommandが旧revisionを指してもside effectを起こさない。

### 9.3 Mutable statusをauthorityにしない

`reviewStatus / validity / promotionStatus`を単一mutable recordの正本として使わない。

formal authorityは次の3系統へ分ける。

```text
review truth
  = immutable ReviewDecision ledger

freshness truth
  = deterministic ValidityCheck result

promotion truth
  = immutable PromotionReceipt / operation ledger
```

UI用aggregate statusはこれらからprojectionしてよいが、authorization判定に使わない。

## 10. Review scope model

### 10.1 Phase 1 scope

Phase 1でreviewできるscope:

```text
proposal
option
```

item-level partial approvalは不可。

複数optionのproposalでOption AをapproveしてもOption Bはapproveされない。

一回のapproveで複数optionを同時に選ばない。

### 10.2 ReviewDecision

```text
ReviewDecision
├─ decisionId
├─ consultationId
├─ targetAdviceId
├─ expectedAdviceRevision
├─ expectedConsultationRevision
├─ targetScope
│  ├─ proposal
│  └─ option(optionId)
├─ action
│  ├─ approve
│  ├─ request_revision
│  ├─ request_alternative
│  └─ dismiss
├─ feedback?
├─ sourceTurnId
└─ decidedAt
```

applicationがformal identityとexpected revisionを付与する。

### 10.3 Concurrency contract

review command適用はcompare-and-set型の条件を必須とする。

最低条件:

- owner / conversation一致
- consultation lifecycle = active
- targetAdviceId = activeAdviceId
- expectedAdviceRevision = activeAdviceRevision
- expectedConsultationRevision = current consultation revision
- target scopeが存在する
- 同一command/decisionが未適用

approveとalternative、double approve、別タブ操作等が競合した場合、一つだけがformal state transitionを取得できる。

loser operationはcontrolled stale/no-opとなり、planning side effectを起こさない。

## 11. Context source envelope

answer AIへplain arrayだけを渡してsource状態を失わない。

各sourceは概念上次を持つ。

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
├─ sourceRevision / basis?
├─ semanticDigest?
├─ observedAt
├─ authority
└─ items
```

### 11.1 `empty`の意味

`empty`はsource loadに成功し、authoritativeに対象itemが0件である状態だけを表す。

load failure、timeout、permission error、token budget omissionを`empty`へ変換しない。

### 11.2 Required / optional classification

classificationはvalidated consultation meaningからdeterministic applicationが作る。raw text keywordで決めない。

例:

- 登録教材を明示参照する相談ではBookshelf readがrequiredになり得る。
- formal feasibilityを回答する場合はplanning availability/capacity signalがrequiredになる。
- 一般的な学習方法の相談ではTimetableがoptionalになり得る。

required sourceが`unavailable / omitted / stale`なら、そのsourceを必要とする確定proposalを作らない。

## 12. Context fingerprint and freshness

### 12.1 Fingerprint scope

`contextFingerprint`は「そのproposal生成に実際に使った依存」だけから作る。

概念上含めるもの:

- consumed source identity
- consumed semantic digest / canonical value
- source basis/revision where meaningful
- deterministic signal values + version
- temporal request context
- evidence snapshot digests
- relevant material binding basis

無関係なsource更新でproposalをstaleにしない。

### 12.2 Fuzzy thresholdを使わない

「進捗が大幅に変わったら」等の曖昧な閾値をfreshness authorityにしない。

実際にconsumedしたcanonical contentのsemantic digestが変わればstaleとする。

source revisionが変わってもconsumed canonical digestが同一ならcurrentを維持できる。

### 12.3 AI回答commit前revalidation

approval時だけでなく、AI回答生成中のsource driftも防ぐ。

```text
1. ContextSnapshot F0を作成
2. answer AI call
3. structured output validation
4. 同じdependency setを再読込してF1を作成
5. F0 == F1 の場合だけAdviceProposal commit
6. F0 != F1ならAI resultを破棄
```

source drift時は最大1回だけfresh contextでregenerationしてよい。

二回連続で変化した場合はproposalをcommitせずcontrolled failure / retry案内とする。

staleなAI outputを一瞬でもreviewable proposalとして残さない。

### 12.4 Approval-time revalidation

approve時にcurrent fingerprintを再構成する。

結果:

```text
current
  → promotion candidate

stale
  → promotion block
  → 必要ならnew proposal revision
  → fresh approval required

non_revalidatable
  → promotion block
```

new proposalへ旧ReviewDecisionをcarryしない。

## 13. Consultation clarification state

consultation clarificationはfirst-class stateを持つ。

```text
PendingConsultationClarification
├─ questionId
├─ consultationId
├─ sourceAdviceId?
├─ expectedConsultationRevision
├─ requestedMeaning
├─ issuedAtTurnId
├─ contextFingerprint
└─ createdAt
```

次turnの短い回答はこのidentityへbindする。

既存planningの`lastQuestionContext`等からconsultation questionを再推測しない。

同時に複数のactive consultation clarificationを持たない。

unrelated turnでpending questionがsupersedeされた場合、古い短答を後から適用しない。

## 14. Deterministic calculation boundary

決定論的に計算できるもの:

- 残り500語を25学習日で終えるなら1日20語
- 既存予定を考慮した利用可能時間
- accepted progressからremainingを算出
- deadlineまでの日数
- scheduler / capacity engineが正式に返したfeasibility

これらはapplication-owned truthである。

AIが同じ数値を推測で上書きしない。

戦略判断:

- どの教材が現在地に合いそうか
- どの順番が良いか
- 基礎へ戻るか演習へ進むか
- 何を優先するか

これらはevidence-grounded advisory judgmentとしてAIが生成できる。

## 15. Temporal normalization contract

学習相談では「10月末」「来月末」「試験2週間前」等のtarget periodを扱うため、prose再解釈を禁止する。

### 15.1 Structured temporal candidate

AI outputは期限をuser-facing proseだけで返さず、structured temporal candidateを伴う。

applicationはcaptured request temporal contextを使いcanonical date/rangeへ解決する。

保存する概念:

```text
NormalizedAdviceTemporalTarget
├─ sourceExpression / structured source spec
├─ resolvedStartDate?
├─ resolvedEndDate?
├─ resolvedTargetDate?
├─ referenceDate
├─ timezone
├─ weekStartsOn where relevant
└─ resolutionPolicyVersion
```

### 15.2 Reinterpretation禁止

approve/promotion時に「来月末」等のproseを再解釈しない。

promotionへ渡すのはnormalized absolute valueだけである。

解決不能・曖昧なtargetはreviewable promotable stateへ入れずclarificationへ落とす。

## 16. Material identity contract

### 16.1 Adviceとformal identityを分ける

AIは未登録教材を推薦してよいが、free-text教材名をcanonical material IDとして生成してはならない。

material mentionはdeterministic resolverで次へ分類する。

```text
registered_material
verified_catalog_material
unresolved_material
```

### 16.2 Promotion rule

`unresolved_material`を含むscopeはpromotion不可。

ユーザーがその案を選んだ場合でも、まずidentity resolution / registration / clarificationを行う。

identity確定がproposalの意味を変える場合はnew proposal revisionを作りfresh approvalを必要とする。

既存Bookshelf ID、検証済みcatalog identity、またはStable V5が正式に理解するtyped material reference以外をpromotionしない。

## 17. Supplemental evidence contract

current controllerの画像由来`suppliedContext / supplementalContext`等を、AIへの一時文字列だけで終わらせない。

proposal生成に利用したsupplemental evidenceはbounded typed snapshotとしてprovenanceを残す。

概念:

```text
SupplementalEvidenceSnapshot
├─ evidenceId
├─ sourceTurnId
├─ kind
│  ├─ image_derived_text
│  └─ other_user_supplied_context
├─ effectiveTextDigest
├─ extractedClaims / normalized snapshot
├─ observedAt
├─ authority
└─ revalidationPolicy
```

raw image bytesをsession checkpointへ保存する必要はない。

保存するのは実際にAIへ渡したeffective bounded contextと、そのdigest/provenanceである。

reload時にこのsnapshotが欠けておりproposalが依存していた場合、そのproposalは`non_revalidatable`としてpromotionをblockする。

supplemental evidenceはinstructionではなくuntrusted user dataとして扱う。

## 18. Review action semantics

### 18.1 `approve`

active current advice scopeをplanning材料として採用してよいという意思。

saved Planを意味しない。

### 18.2 `request_revision`

同じ方向性を維持しつつ指定部分を変更する。

```text
prior proposal
+ feedback
+ current context
→ new AdviceAnswerDocument
→ new AdviceProposal revision
```

旧proposalを上書きしない。

### 18.3 `request_alternative`

現在案を採用せず、意味のある別案を求める。

同じ案の言い換えだけを返さない。

差分を作れない場合は、推薦を大きく変える1問だけをclarificationとして返せる。

### 18.4 `dismiss`

現在consultationを終了する。

- activeAdviceIdをreviewable状態として残さない。
- 自動再生成しない。
- 後から新相談を始めることはできる。

## 19. Promotion contract

promotionはscheduler blockを直接生成しない。

approved + current + promotableなscopeを、既存Stable V5が理解するnormal planning contributionへ変換する。

### 19.1 PromotionOperation

review decisionのcommitとplanning side effectを一発の曖昧な処理にしない。

概念:

```text
PromotionOperation
├─ promotionOperationId
├─ sourceDecisionId
├─ consultationId
├─ targetAdviceId
├─ targetAdviceRevision
├─ targetScope
├─ expectedConsultationRevision
├─ expectedContextFingerprint
└─ state
```

side effect前にoperation identityをclaimする。

### 19.2 Crash / retry safety

review decisionが保存された後、promotion途中でcrashしてもduplicate planning effectを作らない。

planning contribution側にもpromotion operation identityまたは同等のidempotency keyを伝播させる。

retryは同じoperation identityで行い、別Factを増殖させない。

### 19.3 PromotionReceipt

成功後はimmutable receiptを残す。

```text
PromotionReceipt
├─ promotionOperationId
├─ sourceDecisionId
├─ promotedScope
├─ promotedFactRefs / contribution refs
├─ contextFingerprint
└─ promotedAt
```

同じdecision/scopeから複数receiptを作らない。

### 19.4 Promotion後の後続修正

一度promotionされたstrategyを後から相談で変更しても、既に作られたplanning factsをsilent mutationしない。

変更はStable V5のnormal correction/lifecycleへ接続する。

## 20. Persistence / reload contract

### 20.1 保存場所を確定する

Phase 1のAdviceProposal / ReviewDecision / ValidityCheck / PromotionReceipt / PendingConsultationClarificationは、Stable V5 persisted session envelopeのconversation-scoped sidecarとして保存する。

conceptual envelope:

```text
WeeklyPlanningStableV5PersistedSessionV2
├─ version
├─ ownerId
├─ weekStartDate
├─ conversationId
├─ graph
├─ planningState
├─ consultationState
└─ savedAt
```

Fact GraphへAdviceProposalを複製しない。

renderer messagesだけへ保存することも禁止する。

### 20.2 Version migration

現行v1 checkpointからv2へmigrationする。

v1にはconsultation stateが存在しないため、restore時はempty consultation stateを生成する。

過去message proseからAdviceProposalを復元してはならない。

v1のassistant messageに助言らしい文章が残っていてもreviewable proposalにはならない。

### 20.3 Save / restore invariants

restore時に最低限検証する。

- ownerId一致
- conversationId一致
- activeAdviceIdがproposal ledgerに存在
- activeAdviceRevision一致
- lineage cycleなし
- decision targetが存在
- receipt source decisionが存在
- pending clarification targetが存在
- duplicate operation identityなし

malformed consultation stateはsilent partial restoreしない。

### 20.4 Clear / reset / export / import

- clear conversation: consultation stateもclearする。
- reset session: consultation stateもnew conversationへcarryしない。
- export snapshot: consultation stateを含める。
- import snapshot: consultation stateも同一validatorで検証する。
- pending async resultはcheckpoint authorityへしない。

### 20.5 Size budget

checkpoint budget超過時にactive advice、review decision、promotion receiptだけをsilent dropして保存成功扱いしない。

historical contentをcompactする場合はexplicit schema/versionを持つ。

active stateを保存できない場合はcheckpoint failureとして扱う。

### 20.6 Cross-device

Phase 1ではconsultation stateはlocal/session checkpoint authorityであり、cross-device syncを提供しない。

将来cloud authorityを導入する場合は [../../client-runtime/](../../client-runtime/README.md) がreconciliation ownerとなる。

## 21. Memory boundary

Adviceはdurable memoryではない。

```text
assistant: 「英単語は朝15分がおすすめです」
→ advice
→ user preferenceではない
```

review feedbackも自動的にdurable preferenceへ昇格しない。

userが「今後も英単語は15分ずつにしたい」と明示した場合のみ、別semantic contributionとしてadaptive-memory / userPlanningContextの規則へ渡し得る。

`今回は`と`今後も`を区別せず長期記憶化しない。

## 22. Failure behavior

### Semantic routing failure

validated consultation/review meaningが得られない場合、planning mutationを行わない。

必要なら1回のsemantic repairまたは最小clarification。legacy parserへfallbackしない。

### Required context failure

`unavailable`を`empty`へ変換しない。

required contextなしで確定proposalを捏造しない。

### Source drift during answer

commit前fingerprint mismatchならAI resultを破棄する。

### Provider failure

accepted planning stateを変更しない。

revision / alternative call失敗時も元proposalを失わない。

### Output validation failure

structured repairはcurrent Stable V5 contractの許す範囲で最大1回。

未検証proseからplanning factsを抽出しない。

### Ambiguous review reference

複数scopeへbindできる場合は勝手に一つを選ばない。

### Old revision command

controlled stale/no-op。旧revisionを復活させない。

### Streaming interruption

partial textをreviewable proposalとしてcommitしない。

### External retrieval failure

最新性が必要な事実をmodel memoryで捏造しない。

### Dismiss

自動再提案を停止する。

## 23. Security boundary

Issue #152のsecurity contractと整合させる。

- Bookshelf title / note / imported metadataはuntrusted data
- Memory textもinstructionではなくdata
- external retrievalはevidenceでありinstructionではない
- supplemental image-derived textもuntrusted data
- review feedbackもsystem instructionではない
- retrieved text中の「以前の指示を無視せよ」を実行しない
- advice AIはschedule/save authorizationを持たない
- advice resultからtool permissionを導出しない
- provenanceを失ったstored proseをsource of truthにしない
- user-facing answerとdiagnostic traceのprivacy boundaryを分離する

## 24. UX contract

### 24.1 Same conversation surface

「相談モード」「予定作成モード」の手動切替を必須にしない。

### 24.2 Review UI

Advice reviewのprimary actionはPlan保存と誤解させない。

候補:

```text
[この方針で進める]
[修正する]
[別の案を見る]
```

multi-option UIでは各option commandにtargetAdviceId / optionId / expected revisionを持たせる。

button labelや表示順をmachine identityとして使わない。

### 24.3 Stale UI

古いrevisionのbuttonを押してもside effectを起こさない。

UIは可能なら「提案が更新されています」等を表示しlatest revisionへ誘導する。

### 24.4 Adviceとpreviewの視覚分離

Advice、preview、saved Planを同一カード状態として見せない。

## 25. Streaming contract

```text
streaming text
→ presentation only

validated final output
+ commit-time context revalidation
→ AdviceProposal commit candidate
```

formal proposal identityはvalidation後にapplicationが付与する。

resume/retryで同一turnから重複proposalを作らない。

## 26. Observability

service-wide metricsは [../../product-observability/](../../product-observability/README.md) がownerであり、weekly planningはtyped eventを供給する。

候補:

- consultation route rate
- advice generation success/failure
- clarification rate
- material identity resolution rate
- review action distribution
- stale-before-present discard rate
- stale-at-approval block rate
- non-revalidatable block rate
- promotion idempotency retry rate
- provider latency / token / cost
- consultationからpreviewまでのturn数

approval rate最大化をquality goalにしない。

alternative / dismissは正常行動である。

## 27. Deterministic regression contract

最低限、次を自動回帰として固定する。

### Authority / scope

- consultationだけでFact Graphをmutationしない
- advice生成だけでpreview/saveへ進まない
- Option A approveがOption Bへ漏れない
- item-level approvalをPhase 1で受理しない
- rationale explanationがnew revisionを作らない
- explanation後の「それでいい」がactive adviceへbindする

### Revision / concurrency

- v2生成後にv1 approveを拒否する
- stale UI commandを拒否する
- double approveでplanning effectが一回だけ
- approve vs request_alternative concurrencyで一方だけがcommit
- retry/reload後も同一promotionを重複適用しない
- cancel後の遅延AI resultをcommitしない

### Context freshness

- AI回答生成中のBookshelf progress変更を検出する
- AI回答生成中のgoal変更を検出する
- consumedしていないsource変更では不要にstale化しない
- approval直前source変更をblockする
- required source `empty`と`unavailable`を区別する
- omitted contextをempty扱いしない

### Persistence

- answer → reload → approve
- revision → reload → latestのみreview可能
- dismiss → reload → 自動再提案なし
- approve → promotion途中crash → reload → idempotent resume
- clear/resetでconsultation stateが残らない
- export/importでlineageとreview identityを保持
- v1 checkpoint → v2 migrationでfake proposalを作らない
- malformed consultation stateをpartial restoreしない

### Supplemental evidence

- image-derived evidence使用後のreloadでsnapshotを復元
- evidence snapshot欠落時はnon-revalidatable
- supplemental contentをinstruction扱いしない

### Temporal

- 月跨ぎの「来月末」
- year boundary
- timezone差
- exam date relative target
- normalized targetをapproval時に再解釈しない

### Material identity

- registered materialへ一意bind
- alias ambiguityはfail safe
- same-name/different-editionを混同しない
- unresolved materialをpromotionしない

### Clarification

- consultation clarificationへの短答をplanning clarificationへbindしない
- planning clarificationへの短答をconsultationへbindしない
- pending consultation questionのold revision responseを拒否する

### Failure

- provider failureでaccepted state不変
- validation failureでunvalidated proposalなし
- partial streaming outputがproposalにならない
- request_alternative failureで元proposalが残る

## 28. Real-model Japanese evaluation

少なくとも次を自然会話として評価する。

```text
「数学の点数を上げたいけど、どの参考書をいつまでに仕上げればいい？」
「英語が苦手なんだけど何から始めればいい？」
「この参考書難しいけど変えた方がいい？」
「金フレ終わったら次何やる？」
「なんでそれがおすすめ？」
「それでいい」
「1つ目で」
「教材はそれで、期限だけ11月末にして」
「教材はそれで、期限だけ11月末にして、そのまま予定組んで」
「その教材は嫌。別の案にして」
「いや、それも違う」
「もういい、今回はやめる」
「今後もそのやり方にしたい」
「このままで間に合う？ 無理なら少し増やして」
```

見るべきもの:

- route
- context source status
- grounding
- material identity
- temporal normalization
- review scope
- active revision binding
- freshness
- promotion delta
- preview boundary
- memory scope

## 29. Browser / E2E contract

最低限:

- consultation → answer: previewなし
- consultation → approve → preview
- multi-option → one option approve only
- revision → v2 → old v1 UI action rejected
- request_alternative → v2
- dismiss → no regeneration
- rationale → same proposal → approve
- answer生成中context変更 → stale result not presented
- approval直前context変更 → block / regenerate
- reload後continuity
- image-derived context → reload
- double tap approve
- desktop/mobile
- provider failure UX

## 30. Issue #246 implementation acceptance criteria

Issue #246は、次をすべて満たすまでruntime完了としない。

1. consultationをplanning operationとtyped semantic上区別する。
2. raw-text regex/keyword routerをsemantic authorityとして導入しない。
3. current `study_advice`や既存LearningStrategyProposalと二重authorityを作らない。
4. Answer AI outputが`proposal / clarification / explanation`のvalidated discriminantを持つ。
5. advice生成だけでaccepted planning state、preview、Plan、durable memoryが変化しない。
6. AdviceProposal revisionはimmutable lineageを持つ。
7. active leaf以外をreviewできない。
8. review commandはexpected consultation/advice revisionへbindする。
9. multi-option approvalがsibling optionへ漏れない。
10. mixed revision + schedule requestでnew revisionを暗黙approveしない。
11. review/promotion concurrencyで二重side effectを作らない。
12. AI answer commit前にcontext freshnessを再検証する。
13. approval時にもcontext freshnessを再検証する。
14. context sourceのempty/unavailable/omitted/staleを区別する。
15. relative targetをcanonical absolute valueへnormalizeする。
16. unresolved material identityをpromotionしない。
17. supplemental evidence provenanceをreload可能な形で保持する。
18. consultation clarificationをplanning clarificationと別typed stateで保持する。
19. AdviceProposal / ReviewDecision / validity evidence / promotion receiptをpersist/restoreする。
20. v1→v2 session migrationでassistant proseからstateを再構成しない。
21. repeated request / retry / reloadでduplicate planning effectを作らない。
22. promotion後もStable V5 readiness / scheduler / preview / Plan approval / saveを通る。
23. review feedbackをdurable memoryへ自動昇格しない。
24. deterministic calculationをAIが上書きしない。
25. Issue #152 security boundaryと整合する。
26. deterministic regression、Real API evaluation、Browser Regressionで代表flowを検証する。
27. desktop/mobile双方で主要操作が成立する。
28. trace/persistence変更時はfeature-local trace gateを満たす。
29. exact current HEADでcanonical docsとimplementationが同期している。
30. current main取り込み後のruntime再監査で新しいauthority conflictがない。

## 31. Phased evolution

### Phase 0: contract / research / adversarial audit

完了。

- initial requirement
- prompt/evidence design
- OSS/research review
- repository regression pattern audit
- concurrency / persistence / freshness / identity hardening

### Phase 1: core consultation loop

実装対象:

- typed consultation / review routing
- bounded context source envelope
- context fingerprint
- answer purpose
- `proposal / clarification / explanation`
- AdviceProposal immutable lineage
- proposal/option-level review
- active leaf expected-revision guard
- commit-time freshness check
- approval-time freshness check
- session persistence v2
- promotion operation / receipt
- material identity promotion guard
- temporal normalization
- regression / Real API / Browser tests

Phase 1ではitem-level partial approvalとcross-device consultation syncを行わない。

### Phase 2: richer review / grounding

- item-level partial approval
- richer option comparison
- catalog integration
- evidence detail UI
- stronger material disambiguation
- richer stale explanation

### Phase 3: planning intelligence

- deterministic capacity / feasibility integration
- goal / exam milestone modeling
- stronger Actual / Reporting evidence
- strategy comparison
- alternative simulation
- consequence explanation

### Phase 4: retrieval / longitudinal coach

- trusted external retrieval / RAG
- fresh exam/material information
- consultation history
- performance-aware recommendation
- proactive suggestion candidate

proactive suggestionもsilent applyせず同じreview boundaryを通す。

## 32. Open implementation choices

以下はruntime実装時に決めてよいが、上記の意味契約を変更してはならない。

- exact TypeScript type / file names
- exact ID string format
- exact storage field names
- exact hash algorithm for semantic digest/fingerprint
- initial UIでstreamingを有効にするか
- source selectionのtoken budget値
- closed historical proposalのcompact方式
- external retrieval導入時期

次はopenではない。

- active revision guard
- expected revision concurrency control
- commit-time freshness check
- approval-time freshness check
- persistence sidecar
- v1→v2 migration behavior
- context status distinction
- relative temporal normalization
- unresolved material promotion block
- mixed revision + approvalの再承認必須
- consultation clarificationの専用typed state

## 33. Dependency / ownership map

```text
weekly-planning
  owns:
    consultation routing
    consultation state
    review binding
    freshness checks
    promotion into planning

Bookshelf / StudyMaterial
  owns:
    registered material identity
    user progress
    user-specific material state

userPlanningContext
  owns:
    durable explicit user context / preference

external-integrations
  owns:
    retrieval/provider adoption
    normalization
    quota/terms/fallback

reporting
  owns:
    deterministic Actual aggregation

client-runtime
  owns:
    future local/cloud/sync authority and reconciliation

product-observability
  owns:
    service-wide consultation/review/cost metrics

weekly-planning trace
  owns:
    detailed diagnostic evidence for this runtime
```

一つのdecisionに複数ownerを作らない。

## 34. Adopted external patterns

調査evidenceとして次のpatternを採用する。

OpenAI Agents SDK:
- approval対象をstable identityへscope
- resume可能なstate
- managerがspecialistをtool-likeに呼ぶ
- streaming presentationとformal stateを分離

LangGraph / LangGraphJS:
- thread-scoped checkpointとlong-term memoryを分離
- interrupt/resumeにdurable identity
- human decisionをstate transitionとして扱う
- retry side effectをidempotentにする

教育系OSS/研究からは、learner context、evidence、strategy generation、planning executionを分離する考え方のみ採用し、他repoのagent構成やmemory modelをそのままコピーしない。

## 35. Pre-implementation gate

2026-08-31 adversarial re-auditで見つかったCritical / High項目は本仕様へ反映済みである。

仕様上のblockerは解消済みであり、documentation hardening gateはclosedとする。

ただしruntime implementation開始前に、現在branchへcurrent mainを取り込み、そのexact HEADで次を再確認することを実装pre-flightの必須条件とする。

1. existing semantic typesとのauthority conflictがない。
2. persisted session codecとのv2 migration方針が実装可能である。
3. `study_advice` / existing learning strategy proposalとの責任分離が維持できる。
4. current controllerのpending-turn / cancellation contractとconsultation concurrency contractが矛盾しない。
5. current Bookshelf / userPlanningContext owner dataからfingerprint dependencyを取得できる。

current mainとの差分監査では、registered-material / timetable context配線の変更は確認したが、本仕様の責任境界を変更する新しいspec blockerは確認されなかった。

したがって次の工程は、current mainを取り込んで上記pre-flightを再確認した後、TypeScript runtime implementationへ進むことである。
