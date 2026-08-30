# Learning Consultation and Advice Contract

Status: canonical product requirement / runtime implementation in progress
Updated: 2026-08-30
Owning Issue: [#246](https://github.com/kame447/StudyPlanner/issues/246)

Parent product intent: [product-intent.md](product-intent.md)
Current production runtime: [../architecture/current-contract-v5.md](../architecture/current-contract-v5.md)
Semantic ownership: [../architecture/weekly-planning-semantic-ownership-boundary-v5.md](../architecture/weekly-planning-semantic-ownership-boundary-v5.md)
Human grounding: [../policies/human-grounding.md](../policies/human-grounding.md)
Adaptive memory: [../policies/adaptive-memory.md](../policies/adaptive-memory.md)
Material metadata: [../../external-integrations/spec/material-metadata.md](../../external-integrations/spec/material-metadata.md)
Prompt / evidence design: [learning-consultation-prompt-and-evidence.md](learning-consultation-prompt-and-evidence.md)
Test philosophy: [../quality/test-philosophy.md](../quality/test-philosophy.md)
Current roadmap: [../roadmap/current.md](../roadmap/current.md)

## 1. 文書の役割

この文書は、AI計画に「予定を作る前段階の学習相談」を追加するための正仕様である。

対象は、単に既存条件から予定を生成する依頼ではなく、学習方針そのものをユーザーが相談し、提案をレビューし、承認した方針だけを既存planningへ接続するturnである。

代表例:

- 「数学の点数を上げたいけど、どの参考書をいつまでに仕上げればいい？」
- 「英語が苦手なんだけど、何から始めればいい？」
- 「この参考書が難しすぎるけど、変えた方がいい？」
- 「金フレが終わったら次に何をやればいい？」
- 「共通テスト数学を伸ばしたい。今の教材のままでいい？」
- 「この勉強法で間に合う？」
- 「なぜその教材がおすすめなの？」

現行Stable V5は予定作成に必要な不足情報をassistant側から確認できる。本Issueが扱うのは逆方向、すなわちuserがStudyPlannerへ学習戦略を質問し、回答をレビューし、明示的に承認した方針だけを後続planningへ接続する能力である。

production runtimeへこの機能が完全実装されるまでは [current-contract-v5.md](../architecture/current-contract-v5.md) のproduction baselineが優先される。

## 2. Product goal

同じAI計画の会話面で次を成立させる。

```text
相談する
→ 方針・教材・順序・目安期限について助言を得る
→ 理由や代替案を聞く
→ proposalをレビューする
   ├─ approve
   ├─ request_revision
   ├─ request_alternative
   └─ dismiss
→ approveされたproposalをcurrent contextで再検証する
→ approved + currentなscopeだけを既存Stable V5の計画条件へpromotionする
→ readiness / scheduler
→ preview
→ Planの最終承認
→ save
```

最終的なproduct outcomeは「AIがそれらしい勉強法を話すこと」ではない。

ユーザーが、自分の目標・現在地・教材・予定・進捗にgroundされた提案を理解し、修正・別案・終了も含めて自分で判断し、その意思だけが安全に既存planning runtimeへ接続されることを目的とする。

## 3. Core invariants

最重要不変条件は次である。

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
= この学習方針をplanning材料として使ってよい

Plan approval
= 実際に生成されたpreviewを保存してよい
```

AIが「基礎問題精講を10月末までに終えるのがおすすめ」と回答しただけでは、次のどれも成立しない。

- ユーザーがその教材を使うと決めた
- 10月末を期限として承認した
- schedulerへ渡してよい
- Planとして保存してよい
- 長期記憶として保持してよい

assistant proseをmachine stateやauthorizationの代替にしない。

ユーザーのreview actionをsemantic layerが意味として解釈し、deterministic applicationが対象proposal、scope、revision、validityを検証した後にだけ、approved scopeをplanning inputへpromoteできる。

## 4. Product scope

### 4.1 対象とする相談

初期実装は、予定作成と意味的に接続できる学習相談を対象とする。

- 学習戦略: 何から始めるべきか、どの順序がよいか
- 教材選択: どの教材を使うべきか、今の教材を継続すべきか
- 教材遷移: この教材の次に何をやるべきか
- 目標分解: 目標点までにどの段階をいつまでに終えるべきか
- 期限提案: 参考書や範囲をいつまでに終えるのが妥当か
- feasibility explanation: 今のペース・残り時間・既存予定で現実的か
- 学習方法: 復習頻度、演習中心か講義系を挟むか等
- 比較: AとBのどちらを選ぶか、複数案のtrade-off
- 理由説明: なぜその順序・教材・期限を推すのか

### 4.2 初期非対象

- StudyPlannerと無関係な汎用雑談assistant化
- AI回答から直接Planを書き込むshortcut
- 「数学ならこの参考書」のような巨大な決定論的教材heuristic表
- 教材推薦だけを目的とするランキングサービス
- Web全体を無制限に検索するautonomous research agent
- 学習科学の高度な個人モデルを最初から全面導入すること
- AI回答を自動的に長期記憶へ保存すること
- Goal / Bookshelf / Timetable / Actual / Reportingのsource of truthを相談機能へ複製すること
- consultation専用の独立UI modeを必須にすること

## 5. Existing StudyPlanner boundariesとの関係

この機能はStable V5の原則を変更せず、予定作成より手前にadvisory branchを追加する。

### AIが所有する意味

- current turnが相談・助言要求を含むか
- 何について相談しているか
- 学習目標、教材、科目、期限、比較対象等の自然言語上の意味
- proposal / option / itemへのcontextual reference
- user review actionの意味
  - `approve`
  - `request_revision`
  - `request_alternative`
  - `dismiss`
- revision / alternativeに対するuser feedbackの意味
- `今回は` / `今後も` 等のscope meaning
- recommendationに必要な曖昧さが自然言語上存在すること

### Deterministic applicationが所有するもの

- consultation routeを実行可能状態として受理するか
- source-of-truthごとのcontext取得
- context budget / provenance / revision
- advice ID / option ID / item ID / review decision ID
- proposal revision / lineage
- review binding
- validity / stale判定
- promotion state
- promotion transaction / idempotency
- planning Fact Graphへ入れる正式な構造
- readiness / scheduler / preview / Plan approval / save
- persistence / sync / recovery

### Answer AIが所有するもの

- grounded contextに基づく学習戦略・教材選択・順序・説明の生成
- 複数案の比較やtrade-offの言語化
- revision requestを踏まえた修正版の生成
- alternative requestを踏まえた実質的に異なる別案の生成
- 必要な場合の最小限のtargeted clarification
- 不確実性や前提の説明
- deterministic calculationやcatalog evidenceを人間が理解しやすい形で説明すること

Answer AIはformal review state、validity、promotion、scheduler placement、Plan approval、saveを所有しない。

## 6. Intent / turn routing contract

### 6.1 `question`という語を既存意味と衝突させない

現行weekly planningでは、applicationがユーザーへ不足情報を聞くclarification actionとして`question`概念を使っている。

Issue #246が扱う「userがassistantへ質問すること」を同じmachine labelへ雑に重ねない。

```text
assistant clarification
  application → userへ質問

user consultation
  user → StudyPlannerへ学習相談
```

### 6.2 初期routingは粗く保つ

production semantic routingを教材名や科目ごとの大量keyword/regexにしない。

少なくとも次を安全に分ける。

```text
planning_operation
consultation
other / unsupported / unresolved
```

必要ならevaluation上のsubtypeを持てる。

```text
learning_strategy
material_selection
material_transition
sequence_recommendation
target_or_deadline_recommendation
feasibility_explanation
learning_method
comparison
rationale
```

subtypeをraw-text heuristic authorityにしない。

### 6.3 Review action routing

proposalがpresentedされている文脈では、user responseを少なくとも次へ意味分類できる必要がある。

```text
approve
request_revision
request_alternative
dismiss
unresolved
```

例:

- 「これでいい」「1つ目で」「その方針で進めたい」→ `approve`
- 「教材はそれで、期限だけ11月末にして」→ `request_revision`
- 「その教材は嫌。別の案にして」→ `request_alternative`
- 「もういい」「今回は相談やめる」→ `dismiss`

「それで予定組んで」のような発話もsemantic上`approve`になり得るが、この表現を必須トリガーにはしない。

### 6.4 mixed turn

次のようなturnは単純なsingle-label分類では足りない。

```text
「このままで間に合う？ 無理なら少し増やして」
```

consultationとconditional mutationを同時に含み得るため、raw textを分割するad-hoc parserを追加しない。

current schemaで安全にatomic handlingできない場合は、意味を失わない最小clarificationまたは段階処理へ落とす。

## 7. Orchestration model

### 7.1 Manager pattern

StudyPlanner applicationが会話・状態・正式lifecycleのownerであり続ける。

```text
user turn
→ Stable V5 semantic interpretation
→ validated consultation contribution
→ deterministic consultation orchestration
→ bounded ConsultationContext
→ learning-advice answer purpose
→ validated AdviceAnswerDocument
→ deterministic AdviceProposal commit
→ user-facing response
→ user review
```

review後の分岐:

```text
approve
→ deterministic revalidation
→ currentならpromotion
→ Stable V5

request_revision
→ prior proposal + feedback + current context
→ learning-advice answer purpose
→ new proposal revision

request_alternative
→ prior proposal + feedback + current context
→ learning-advice answer purpose
→ materially different proposal revision

dismiss
→ consultationを終了
→ 自動再生成しない
```

### 7.2 Full handoffを初期採用しない

consultation specialistへconversation authorityを丸ごと移さず、application managerが正式state ownerに残る。

理由:

- Stable V5の正式state ownerを維持できる
- adviceからschedule mutationへの越権を防ぎやすい
- review / validity / promotionを一箇所で管理できる
- trace / cost / security policyを統一できる
- answer providerを差し替えやすい

## 8. ConsultationContext grounding

### 8.1 原則

回答AIへ質問本文だけを渡さない。

```text
source domain
→ bounded read model / context projection
→ ConsultationContext
→ answer AI
```

contextへ含めたからといって、元データをweekly planning Fact GraphやMemoryへ複製しない。

### 8.2 Context source候補

質問との関連性に応じて次を利用できる。

- current conversation / accepted planning state
- user-stated goal / durable planning context
- Bookshelfの登録教材、alias、progress、pace metadata
- material catalog identity / bibliographic metadata
- Timetable
- existing Schedule / Plan
- Actual / observed study evidence
- Reportingが所有するdeterministic aggregate
- planning availability / capacity signal
- authoritative exam / goal date
- accepted current-session constraints

すべてを毎回渡さず、relevanceとtoken/privacy budgetでboundedにする。

### 8.3 Provenance

context itemは少なくとも次を追跡できる必要がある。

- source domain
- source identity
- source revision / updated basis when available
- authority
- scope
- observation / retrieval time when relevant

### 8.4 Bookshelf boundary

Bookshelfは登録教材とユーザー固有進捗のsource of truthである。

consultationが登録教材を参照しても、`scope_total`、`completed`、`currentUnit`等を「AIが言った事実」として複製しない。

material aliasが一意に解決しない場合は1冊へ勝手にbindしない。

### 8.5 External material metadata boundary

共有catalog / NDL等の外部書誌は教材identity・ページ数・目次等のevidenceであり、「その教材をやるべき」という学習判断のauthorityではない。

provider固有responseをanswer promptやdomain stateへ直接漏らさない。

## 9. Knowledge and evidence tiers

教材・学習戦略回答では根拠の種類を区別する。

### Tier 1: user-owned authoritative context

- 明示目標
- 登録教材
- 現在進捗
- 実際の学習実績
- 試験日
- 既存予定
- 明示的な制約・希望

### Tier 2: StudyPlanner-owned normalized knowledge

- curated material identity
- alias / series identity
- shared bibliographic catalog
- StudyPlannerが正式に保持する教材metadata

### Tier 3: trusted external retrieval

RAG / Web / provider検索。

provider、利用条件、normalization、fallbackは [../../external-integrations/](../../external-integrations/README.md) がownerとなる。

claim typeごとの詳細source policyは [learning-consultation-prompt-and-evidence.md](learning-consultation-prompt-and-evidence.md) を参照する。

### Tier 4: model general knowledge

一般的な学習法、典型的な教材の位置付け、教育的な説明等。

model-only knowledgeを最新の版・ISBN・ページ数・公式難易度等の確定事実として話さない。

## 10. AdviceAnswerDocument

assistant proseだけをmachine stateの唯一の表現にしない。

```text
AdviceAnswerDocument
├─ user-facing explanation
├─ recommendation / option candidates
├─ rationale
├─ assumptions
├─ uncertainty
├─ evidence/provenance references
├─ possible planning implications
└─ whether one missing input materially blocks a useful answer
```

### 10.1 Recommendation item

予定へ昇格する可能性がある内容はstable item identityを持てるようにする。

例:

```text
Option A
- material: 基礎問題精講
- milestone: 基礎例題を完了
- suggested target date: 10月31日

Option B
- material: 青チャート
- milestone: 重要例題を中心に進める
- suggested target date: 11月15日
```

後続の「2つ目で」をoption identityへbindできることが重要である。

### 10.2 Uncertainty

根拠が薄いrecommendationを確定口調にしない。

未校正の架空確率も生成しない。

例:

- 現在得点が不明なので、基礎不足を仮定した案
- 教材の版が一意に特定できていない
- 実績データが少ないので必要時間は概算

## 11. Question economy for consultation

「あると便利な情報」と「無いとrecommendationが実質的に変わるblocking information」を分離する。

- known contextを聞き直さない
- recommendationが大きく変わる不足だけを質問する
- 仮定を明示すれば有用な回答を出せるなら先にprovisional adviceを出してよい
- 1turnで大量のプロフィール入力を要求しない
- 「わからない」を許容する
- planning開始時のslotをconsultation開始時から全部聞かない

revision / alternativeが繰り返される場合も固定回数で機械的に質問へ切り替えない。

ただし、過去feedbackだけでは次の案を有意に差別化できない場合、answer AIはrecommendationを大きく変える1問だけをtargeted clarificationとして返せる。

## 12. Deterministic calculation boundary

### 12.1 決定論的に計算できるもの

- 残り500語を25学習日で終えるなら1日20語
- 既存予定を考慮した利用可能学習時間
- accepted progressからremainingを算出
- explicit deadlineまでの日数
- scheduler / capacity engineが正式に返したfeasibility

これらはdeterministic applicationがsource of truthとなる。

### 12.2 戦略判断

- どの参考書が現在地に合いそうか
- どの順番で教材を進めるか
- 基礎へ戻るべきか演習へ進むべきか
- 何を優先すべきか

これらはevidence-grounded advisory judgmentとしてAIが生成できる。

AIがscheduler計算を想像して「余裕で間に合います」と断定しない。

## 13. AdviceProposal / Review state model

consultation回答はconversation-scoped advisory stateとして保持する。

### 13.1 AdviceProposal

概念モデル:

```text
AdviceProposal
├─ adviceId
├─ consultationId
├─ owner / conversation
├─ revision
├─ sourceQuestionTurnId
├─ supersedesAdviceId
├─ structured options/items
├─ assumptions
├─ evidence refs
├─ contextRevisionFingerprint
├─ createdAt
├─ reviewStatus
├─ validity
├─ promotionStatus
└─ supersededByAdviceId
```

proposal revisionはimmutableに近い扱いを優先する。

「期限だけ変えて」のような修正でv1を上書きせず、v1を履歴として残し、v2を生成する。

### 13.2 一本のlifecycle enumに潰さない

次の3軸を分離する。

```text
reviewStatus
  presented
  approved
  revision_requested
  alternative_requested
  dismissed

validity
  current
  stale

promotionStatus
  not_promoted
  promoted
  blocked
```

理由:

- `approved`後にも前提変更で`stale`になり得る
- `alternative_requested`は相談終了ではない
- `dismissed`は再生成すべきではない
- `promoted`かどうかと人間のreview判断は別責任である

`superseded`は単独statusへ押し込むより、proposal lineage (`supersedesAdviceId` / `supersededByAdviceId`) で追跡できる設計を優先する。

### 13.3 ReviewDecision

user reviewはfirst-class command / recordとして対象identityを持つ。

```text
ReviewDecision
├─ decisionId
├─ targetAdviceId
├─ targetOptionIds / targetItemIds
├─ action
│  ├─ approve
│  ├─ request_revision
│  ├─ request_alternative
│  └─ dismiss
├─ feedback
└─ decidedAtTurnId
```

ReviewDecisionのformal binding、ID、idempotencyはdeterministic applicationが所有する。

### 13.4 Feedbackのauthority

review feedbackは次のproposal生成に使う重要contextである。

例:

```text
Proposal v1:
  標準問題精講を使う

User:
  「それは重すぎるから嫌。別の案にして」
```

次回answer inputにはv1とfeedbackを含める。

ただし「重すぎる」というfeedbackを自動的に教材の客観factやdurable preferenceへ昇格しない。

### 13.5 Item-level scope

proposal全体だけでなくoption/item単位のidentityを持てる構造を優先する。

- 「2つ目で」
- 「教材はAで、期限だけ遅くして」
- 「復習方法だけ変えたい」

## 14. Review / promotion contract

### 14.1 `approve`

`approve`は「この助言の対象scopeをplanning材料として採用してよい」という意味である。

saved Planになったことを意味しない。

```text
advice approve
→ context revalidation
→ currentならplanning contributionへpromotion
→ Stable V5 readiness
→ scheduler
→ preview
→ Plan approval
→ save
```

### 14.2 Approval時のrevalidation

proposal生成時の`contextRevisionFingerprint`とapproval時のcurrent contextを比較する。

重要sourceが変わっていれば、approvedであっても直接promoteしない。

```text
reviewStatus = approved
validity = stale
promotionStatus = blocked
```

この場合はrevalidation / regeneration / targeted clarificationを行い、新proposalが生成された場合は再承認を必要とする。

### 14.3 `request_revision`

同じ方向性を維持しつつ指定箇所を修正する意図。

```text
prior proposal
+ review feedback
+ current context
→ learning-advice answer purpose
→ new proposal revision
```

元proposalを上書きしない。

### 14.4 `request_alternative`

現在案を採用せず、別の戦略を求める意図。

```text
prior proposal
+ rejected aspects / feedback
+ current context
→ learning-advice answer purpose
→ materially different new proposal
```

同じ案を言い換えて返すだけにしない。

ただし制約上ほぼ同一案しか成立しない場合は、その理由を説明し、必要なら推薦を大きく変える1問だけを聞く。

### 14.5 `dismiss`

相談または現在proposalを終了する意図。

`dismiss`後に自動で別案を生成しない。

これにより「もういい」「今回はやめる」に対してAIが再提案を続けるループを防ぐ。

### 14.6 Deterministic binding

applicationは次を確認する。

- referenced advice / option / itemが現在conversationに存在する
- ownerが一致する
- review actionを適用可能なrevisionである
- ambiguous referenceでない
- validityが検証可能である
- 同一review / promotion operationがすでに適用済みでない

### 14.7 Stale advice

recommendation生成後に重要sourceが変わった場合、古いadviceを黙って適用しない。

例:

- target exam dateが変更
- material progressが大幅更新
- referenced materialが削除・変更
- current goalがsuperseded
- planning availabilityが大きく変更

stale adviceは履歴として表示できるが、直接promotionしない。

### 14.8 Promotion result

promotionはscheduler blockを直接生成しない。

approved + currentなadvice scopeを、既存Stable V5が理解する通常のplanning contribution / typed factsへ変換する。

consultation-specific logicをschedulerの第二ownerにしない。

## 15. Memory and persistence boundary

### 15.1 Adviceは長期記憶ではない

AI recommendationをuser planning contextへ自動保存しない。

```text
assistant: 「英単語は朝15分がおすすめです」
→ advice
→ user preferenceではない
```

userが「今後も英単語は15分ずつにしたい」と別途表明した場合はdurable user-context candidateになり得る。

そのpromotionは [adaptive-memory.md](../policies/adaptive-memory.md) と `userPlanningContext` の規則がownerとなる。

### 15.2 Review feedbackも自動でdurable memoryにしない

「その教材は嫌」「もっと軽い方がいい」等のreview feedbackは、現在consultationの再提案contextとして利用できる。

ただし、`今回は`なのか`今後も`なのかをsemanticに区別せず長期嗜好へ昇格しない。

### 15.3 Conversation/session state

AdviceProposal / ReviewDecisionは初期状態ではconversation/session-scoped stateとする。

cross-device persistence、cloud authority、reconciliation、offline behaviorは [../../client-runtime/](../../client-runtime/README.md) と関連Issueがownerとなる。

## 16. UX contract

### 16.1 Same conversation surface

ユーザーへ「相談モード」「予定作成モード」の手動切替を要求しない。

### 16.2 MVP

- userが自然文で相談できる
- assistantが自然な回答を返す
- 回答だけでpreviewが勝手に出ない
- userが自然文でapprove / revision / alternative / dismissできる
- approve後にcurrent contextを再検証する
- approved + currentなら既存planning previewへ移行する
- advice approvalとPlan approvalを状態上区別する
- adviceとpreview / saved planが視覚的にも区別される

### 16.3 UI wording

Advice reviewのprimary actionは「予定を保存する」と誤解させない。

候補:

```text
[この方針で進める]
[修正する]
[別の案を見る]
```

preview後のfinal actionは既存のPlan save / approval表現を使用する。

### 16.4 Future UI

- 複数案カード
- option比較
- recommendation itemの部分選択
- rationale / evidence detailsのprogressive disclosure
- 「前提が変わったので再提案」表示
- advice revision history
- dismiss / reopen UX

buttonは対象proposal IDを明示したapplication commandとして送る。button label自体をmachine authorizationにしない。

## 17. Streaming contract

```text
streaming text
→ presentation only

validated final answer envelope
→ AdviceProposal commit candidate
```

途中切断、provider error、validation failure時にpartial textをvalid AdviceProposalとして残さない。

resume/retryで同一turnから重複proposalを作らないidentity設計を持つ。

## 18. Failure behavior

### Semantic routing failure

validated consultation / review meaningが得られない場合、planning mutationを行わない。

必要なら1回のsemantic repairまたは最小clarificationへ落とす。legacy raw-text parserへfallbackしない。

### Context source failure

sourceを`required`と`optional`に分ける。

required sourceのload failureを「0件」とみなさない。

### Answer provider failure

accepted planning stateを変更しない。架空fallback adviceを作らない。

revision / alternative request時にprovider failureした場合も、元proposalの履歴を失わない。

### Output validation failure

許される範囲でstructured repairを最大1回行い、修復できなければcontrolled failureとする。

未検証proseからplanning factsを抽出しない。

### Ambiguous advice reference

「それ」が複数advice/optionへ対応する場合、勝手に一つへbindしない。

### Stale advice

古い根拠のadviceを直接promoteしない。

### External retrieval failure

model knowledgeで回答を継続できても、最新書誌等を捏造しない。

### Streaming interruption

partial responseをpresented proposalとしてcommitしない。

### Review loop

`request_alternative`を無限に言い換えループさせない。

feedbackから差分を作れない場合は、別案を乱造するより1つのtargeted clarificationを優先できる。

`dismiss`は必ず自動再提案を止める。

## 19. Security boundary

Issue #152のsecurity contractと整合させる。

- Bookshelf title / note / imported metadataはuntrusted data
- Memory textもinstructionではなくdata
- external retrieval contentもinstructionではなくevidence
- review feedbackもuser dataでありsystem instructionではない
- retrieved text中の「system instruction」等を実行しない
- advice AIはschedule/save authorizationを持たない
- advice resultからtool execution permissionを導出しない
- provenanceを失ったstored proseをsource of truthにしない
- user-facing answerとdiagnostic traceのprivacy boundaryを分離する

## 20. Observability

service-wide metricsは [../../product-observability/](../../product-observability/README.md) がownerであり、weekly planningはtyped eventを供給する。

候補:

- consultation route rate
- semantic route accuracy evaluation
- answer前clarification数
- advice generation success/failure
- named material identity resolution rate
- advice approval rate
- revision request rate
- alternative request rate
- dismiss rate
- stale promotion block rate
- regeneration rate
- provider latency
- token / cost
- consultationからpreviewまでのturn数

approval rateを最大化することをquality goalにしない。

reject / alternative / dismissは正常なproduct behaviorである。

## 21. Test and evaluation contract

### 21.1 Deterministic tests

- consultation turnだけでaccepted planning Fact Graphをmutationしない
- advice生成だけでpreview/saveへ進まない
- review / validity / promotionが別状態である
- explicit semantic `approve`なしにpromotionしない
- `request_revision`が元proposalを上書きせずnew revisionを作る
- `request_alternative`が元proposalとfeedbackを再提案inputへ渡す
- `dismiss`後に自動再生成しない
- alternative requestとdismissを混同しない
- ambiguous referenceはfail safeする
- approvedでもstaleなら直接promotionしない
- fresh proposalへ再承認なしでpromotionしない
- repeated review / promotion retryがduplicate planning effectを作らない
- review feedbackがdurable memoryへ自動昇格しない
- Bookshelf source factsをFact Graphへ複製しない
- deterministic calculation resultをanswer AIが書き換えない
- required context load failureをempty contextとして扱わない
- provider/validation failureでaccepted stateを壊さない
- partial streaming outputをvalid adviceとしてcommitしない
- untrusted stored contentをinstruction扱いしない

### 21.2 Real-model Japanese evaluation

少なくとも次を自然な会話として評価する。

```text
「数学の点数を上げたいけど、どの参考書をいつまでに仕上げればいい？」
「英語が苦手なんだけど何から始めればいい？」
「この参考書難しいけど変えた方がいい？」
「金フレ終わったら次何やる？」
「なんでそれがおすすめ？」
「それでいい」
「1つ目で」
「教材はそれで、期限だけ11月末にして」
「その教材は嫌。別の案にして」
「いや、それも違う」
「もういい、今回はやめる」
「今後もそのやり方にしたい」
「このままで間に合う？ 無理なら少し増やして」
```

見るべきもの:

- semantic route
- context selection
- recommendation grounding
- assumptions
- review action
- reference binding
- revision lineage
- validity / staleness
- promotion delta
- preview boundary
- memory scope

### 21.3 Browser / E2E

- consultation → answer: previewは出ない
- consultation → approve → preview
- consultation → request_revision → v2 → approve → preview
- consultation → request_alternative → v2
- consultation → dismiss: 再提案されない
- multi-option → one option approve
- approval直前にcontext変更 → stale block → regenerated proposal
- reload後のsession continuity
- desktop/mobile
- provider failure UX

## 22. Issue #246 implementation acceptance criteria

1. 学習戦略・教材選択等のuser consultationを通常の予定作成要求と安全に区別できる。
2. raw-text regex/keyword routerを新たなsemantic authorityとして導入していない。
3. consultation時に関連するStudyPlanner contextをsource ownershipを壊さず利用できる。
4. answer AIがvalidated structured adviceを返し、proseだけをmachine truthにしない。
5. advice生成だけではaccepted planning state、preview、Plan、durable memoryが変化しない。
6. user reviewを`approve / request_revision / request_alternative / dismiss`として安全に扱える。
7. contextual responseを正しいadvice / option / item identityへbindできる。
8. revision / alternativeは元proposalを上書きせずlineageを持つnew proposalを生成する。
9. dismissは自動再提案を停止する。
10. approve時にcontextを再検証し、staleならpromotionをblockする。
11. approved + currentなscopeだけがexisting Stable V5へpromotionされる。
12. promotion後も既存Stable V5 readiness / scheduler / preview / Plan approval / saveを通る。
13. repeated request / retry / reloadでduplicate planning effectを作らない。
14. Bookshelf等のauthoritative dataを不必要に複製しない。
15. advice approval、review feedback、durable preferenceを分離する。
16. deterministic calculationはapplication-owned truthのまま維持する。
17. security / prompt-injection boundaryをIssue #152と整合させる。
18. deterministic regression、Real API evaluation、Browser Regressionで代表flowを検証する。
19. desktop/mobile双方で相談→review→previewの主要操作が成立する。
20. trace/persistence変更がある場合はfeature-local `AGENTS.md` のtrace persistence gateを満たす。
21. current canonical docsを実装と同じPRで同期する。

## 23. Phased evolution

### Phase 0: contract / research / eval design

完了。

canonical requirement、prompt/evidence design、責任境界、失敗時挙動、研究/OSS evidenceを整備した。

### Phase 1: core consultation loop

- coarse semantic consultation route
- bounded internal context
- separate answer purpose
- validated structured advice
- conversation-scoped AdviceProposal / ReviewDecision
- `approve / request_revision / request_alternative / dismiss`
- revision lineage
- approval-time staleness check
- approved scopeをexisting Stable V5へpromotion
- regression / Real API / Browser tests

最初から外部Web検索を必須にしない。

### Phase 2: material grounding and richer review

- named material catalog resolution
- evidence/provenance details
- multiple options
- stronger option/item identity
- partial approval
- explicit review action UI
- better stale detection

### Phase 3: planning intelligence

- deterministic capacity / feasibility integration
- goal / exam milestone modeling
- stronger Actual / Reporting evidence
- strategy comparison
- alternative simulation
- plan consequence explanation

### Phase 4: retrieval and longitudinal coach

- trusted external retrieval / RAG
- fresh material/exam information
- consultation history
- performance-aware recommendation
- evidence-backed personalized strategy
- proactive suggestion candidate

proactive suggestionもsilent applyせず同じreview boundaryを通す。

### Phase 5: research-grade adaptation

十分な実データ・評価基盤ができた後に検討する。

- knowledge tracing
- forgetting / recall modeling
- skill graph
- learner state estimation
- counterfactual strategy evaluation
- long-horizon adaptive curriculum

高度なモデルでもuser approval / source ownership / deterministic scheduling境界を外さない。

## 24. Design decisions and rejected alternatives

### Decision A: 巨大heuristic表を作らない

教材・試験・版・目的の組合せをapplicationの巨大rule tableへしない。

AI advisory judgmentをsource-groundedに利用する。

### Decision B: raw LLM chatbotにschedule mutationさせない

```text
user question
→ LLM
→ direct Plan mutation
```

は採用しない。

### Decision C: AI回答を長期記憶のtruthにしない

assistant proposalはuser factではない。

### Decision D: specialistへのfull conversation handoffを初期採用しない

application managerがauthorityを維持する。

### Decision E: advice textから後でregex抽出しない

promotion可能情報は生成時にstructured itemとして保持する。

### Decision F: `reject = 必ず再生成` にしない

却下:

```text
user rejects
→ always regenerate
```

理由:

- 「もういい」でも再提案してしまう
- consultation終了意思を尊重できない
- unwanted regeneration loopを作る

代わりに`request_alternative`と`dismiss`を分ける。

### Decision G: review / stale / promotionを単一lifecycleにしない

`approved`かつ`stale`、`approved`かつ`not_promoted`等の状態を正しく表現するため、別軸で管理する。

### Decision H: revision時にproposalをin-place editしない

過去の根拠と意思決定を追跡できるよう、new revisionを生成しlineageを保持する。

## 25. Open implementation decisions

current code/schemaと照合して決める。

- consultation semantic contributionのexact TypeScript表現
- review semantic actionのexact schema
- mixed consultation + mutation turnのatomicity
- answer purposeのexact identifier
- AdviceAnswerDocumentのexact schema
- AdviceProposal / ReviewDecisionの永続化場所
- proposal ID / revision / lineage generation
- context sourceごとのrequired / optional分類
- context budgetとselection policy
- contextRevisionFingerprintのexact構成
- approval revalidationのchange threshold
- material identity resolutionを必須にする条件
- initial UIでstreamingを使うか
- Phase 1でoption-level approvalをどこまで入れるか
- external retrievalをいつ導入するか
- goal domain正式導入後のcontext ownership
- cross-device advice stateのauthority / reconciliation

## 26. Dependency / ownership map

```text
weekly-planning
  owns: consultation routing, review state, validity, promotion into planning

Bookshelf / StudyMaterial
  owns: registered material identity, user progress, user-specific material state

userPlanningContext
  owns: durable explicit user context / preference

external-integrations
  owns: provider adoption, retrieval, normalization, quota/terms/fallback

reporting
  owns: deterministic Actual aggregation when consultation consumes it

client-runtime
  owns: local/cloud/sync authority and reconciliation

product-observability
  owns: service-wide consultation/review/cost metrics

weekly-planning trace
  owns: detailed diagnostic evidence for this runtime only
```

一つのdecisionに複数ownerを作らない。

## 27. Research evidence and adopted patterns

調査結果はStudyPlannerのsource of truthではなく設計evidenceとして保持する。

### 27.1 OpenAI Agents SDK

Repository:
- https://github.com/openai/openai-agents-python

Relevant docs:
- `docs/human_in_the_loop.md`
- `docs/agents.md`
- `docs/handoffs.md`

採用するpattern:

- approval対象をstable identityへscopeする
- serializable stateからresumeする
- approve / reject feedbackをstateful workflowへ戻せる
- managerがspecialistをtool-likeに呼ぶ
- streaming presentationとformal approval stateを分ける

StudyPlannerではgeneric tool approval modelをそのままcopyせず、AdviceProposal / ReviewDecisionへdomain化する。

### 27.2 LangGraph / LangGraphJS

Repositories:
- https://github.com/langchain-ai/langgraph
- https://github.com/langchain-ai/langgraphjs

採用するpattern:

- thread-scoped checkpointとlong-term memoryを分離する
- interrupt / resumeにdurable identityを持つ
- human approve / reject / editをstate transitionとして扱う
- retry side effectをidempotentにする

framework自体を採用する判断ではない。

### 27.3 Education / tutor architecture evidence

- GenMentor: learner/context理解、skill gap、learning path、content/tutor責任の分離
- OATutor: learner evidenceとinstructional policyを分けて評価する示唆
- TASA: persona / event memory / forgetting-aware stateは将来方向として参考
- Tutor MCP: algorithmic state、episodic memory、narrative contextの分離
- edu-agent: RAG-grounded tutor / weak-point awareness / personalized plan
- Adaptive Educational AI Agent: deterministic ruleとLLM explanationの分離
- AiTutor: syllabus / learning objectiveを会話で調整するflow
- OpenTutor:教材grounding、citation、adaptive workspace
- StudyPal: conversation continuity / shared context

### 27.4 Evidenceの使い方

判断優先順位:

```text
StudyPlanner current code / tests
→ StudyPlanner canonical contract
→ Issue #246 product requirement
→ established framework / research evidence
→ exploratory OSS pattern
```

他repoの型・agent数・memory構造・UIをそのままコピーしない。

## 28. Implementation gate / current status

Phase 0 documentation gateはPR #253でmainへ反映済みであり、runtime implementationへ進んでよい。

実装中も次を満たす。

1. このcanonical specを正仕様として扱う。
2. current production runtimeとplanned behaviorを混同しない。
3. review / validity / promotionを別責任として実装する。
4. `request_alternative`と`dismiss`を混同しない。
5. review feedbackを再提案contextとして保持するが、durable user truthへ自動昇格しない。
6. approved proposalもpromotion直前にstalenessを再検証する。
7. new revisionは元proposalを上書きせずlineageを持つ。
8. raw-text regex/keyword routingをsemantic authorityとして追加しない。
9. future code PRはこのspecとprompt/evidence supporting designを同じreview対象として同期する。
