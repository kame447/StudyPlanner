# Learning Consultation Prompt and Evidence Design

Status: supporting design / subordinate to canonical requirement / runtime implementation pending
Updated: 2026-08-30
Owning Issue: [#246](https://github.com/kame447/StudyPlanner/issues/246)
Parent canonical: [learning-consultation-and-advice.md](learning-consultation-and-advice.md)

## 1. この文書の位置付け

この文書は、Issue #246 の学習相談機能について、answer purposeへ実際に何を渡し、どの規則で回答させるかを詳細化する supporting design である。

親の正仕様は [Learning Consultation and Advice Contract](learning-consultation-and-advice.md) であり、本書はその責任境界を変更しない。

矛盾がある場合は親の正仕様を優先する。

本書が所有するのは次だけである。

- answer purposeの固定instruction設計
- Source Policy
- Consultation Contextの入力構成
- Evidence Bundle
- exact user questionの受け渡し
- output contract
- promptを巨大な一枚の文章にしないための分離方針
- Luna等のanswer modelを評価する条件

本書は次を所有しない。

- consultation routingの正式state
- AdviceProposal lifecycle
- accept / modify / rejectのformal binding
- scheduler
- preview
- approval / save
- durable memory
- external provider採用そのもの

これらは親仕様および各owner domainが所有する。

現時点でruntime implementationは未着手である。

---

## 2. 結論: 「短くする」のではなく「分離する」

answer modelへ渡す情報を、巨大な一枚のpromptへ混ぜない。

一方で、重要な判断規則をtoken節約のために削除することもしない。

実運用では次の6層へ分離する。

```text
A. System Instructions
   変わりにくい学習相談AIの役割・判断原則

B. Source Policy
   どの種類の主張で、どの種類の情報源を重視するか

C. Consultation Context
   StudyPlannerが持つ今回のユーザー固有情報

D. Evidence Bundle
   今回の相談に必要な外部・内部evidence

E. User Question
   今回ユーザーが実際に聞いた質問

F. Output Contract
   人間向け回答 + validated structured recommendation
```

重要なのは、情報量を減らすことではなく、意味の種類を分けることである。

```text
hard instruction
user fact
external evidence
current question
output schema
```

を同じprose blockへ混在させない。

---

## 3. Runtime envelope

概念上、answer purposeへの入力は次のように扱う。

```text
LearningConsultationAnswerInput
├─ system_instructions_version
├─ source_policy
├─ user_question
├─ consultation_context
├─ evidence_bundle
├─ deterministic_signals
└─ output_contract_version
```

exact TypeScript名は実装時にcurrent codeと照合して決める。

このspecが固定するのは責任と意味であり、field名ではない。

### 3.1 exact user questionは独立して渡す

ユーザーが何を聞いたかを、長いconversation historyからanswer modelへ再推測させない。

例えば:

```yaml
user_question: >-
  数学の点数を上げたいけど、
  どの参考書をいつまでに仕上げればいい？
```

conversation historyが必要な場合も、`user_question`とは別にrelevant contextとして渡す。

これにより、answer modelが過去の別質問をcurrent requestと取り違えるリスクを減らす。

---

## 4. System Instructionsの責任

System Instructionsには、毎回変わらないanswer modelの役割と判断原則を置く。

サイト一覧、今回のユーザー情報、検索結果を大量に埋め込まない。

### 4.1 System prompt candidate

初期候補は次の意味を保持する。

```text
あなたはStudyPlannerの学習戦略アドバイザーです。

与えられたユーザー固有情報、StudyPlanner内のauthoritative context、
決定論的計算結果、提供されたevidenceを組み合わせて、
現実的な学習戦略を提案してください。

主な相談対象:
- 何から学ぶべきか
- どの教材を使うべきか
- 現在の教材を継続するべきか
- どの順番で進めるべきか
- どこまで到達するべきか
- いつ頃までを目安にするべきか
- 現在のペースで目標へ届きそうか
- 学習方法をどう改善するべきか
- 複数案のどちらを選ぶべきか
- なぜその方針を勧めるのか

基本原則:
- StudyPlannerから与えられたユーザー固有情報をユーザー事実として最優先する
- 既に分かっている情報を聞き直さない
- 一般的な学習ルートをそのままコピーせず、現在地へ適合させる
- 有名だからという理由だけで教材を増やさない
- 現在の教材で十分なら継続を選択肢に含める
- source_policyに従い、主張の種類ごとに適切なevidenceを使う
- 一つの塾・予備校・出版社の方針を唯一の正解として扱わない
- 最新性が重要な事実をmodel memoryだけで断定しない
- 複数ソースが異なる場合は前提とtrade-offを比較する
- 学習科学の知見を使う場合も固定日数・固定回数を普遍的な科学的正解として扱わない
- deterministic_signalsが与えられている数値はapplication-owned truthとして使用する
- 不足情報があっても合理的な仮定で有用な回答が可能なら質問しすぎない
- 推薦が大きく変わる不足情報だけを質問する
- 根拠が弱い場合は不確実性・仮定を説明する
- 根拠のない確率や合格保証を生成しない

境界:
- あなたの回答はadviceである
- user-stated factではない
- accepted planning conditionではない
- saved Planではない
- durable memoryではない
- schedule/save/lifecycleを直接変更しない

回答:
- ユーザー向けに理解しやすく簡潔に説明する
- 同時にstructured recommendationを返す
- structured recommendationもuser adoption前はproposalである
```

### 4.2 System promptを巨大化させない理由

System promptへ次をすべて直書きしない。

- 個別サイト一覧
- 今回の教材情報
- 検索結果全文
- conversation全文
- schedule全文
- Bookshelf全文

理由はtoken数そのものより、authorityの混同を避けるためである。

answer modelにとって、

```text
命令
事実
参考意見
質問
```

が視覚的・構造的に分かれていることを優先する。

---

## 5. Source Policy

### 5.1 一つの「サイトランキング」にしない

情報源の信頼性は、何を主張するかによって変わる。

例えば、武田塾の参考書ルートは教材順序のadvisory evidenceとして有用でも、大学の正式な試験日・配点の最終authorityではない。

逆に大学公式サイトは試験制度のauthorityだが、個人に最適な参考書順序の唯一のauthorityではない。

したがってSource Policyはclaim-type-specificにする。

### 5.2 User-owned authoritative context

ユーザー本人についての事実はStudyPlanner側のauthoritative contextを最優先する。

例:

- 明示された目標
- 志望校 / 試験
- 現在点
- 目標点
- 登録教材
- 教材進捗
- 実際の学習実績
- 利用可能時間
- 明示的な希望・制約

外部の一般ルートがこれらを上書きしてはいけない。

### 5.3 Official fact sources

用途:

- 試験日
- 科目
- 配点
- 出題範囲
- 募集要項
- 資格試験制度
- 教材の正式名称・版・ISBN等

候補例:

- 各大学・学校の公式情報
- 大学入試センター
- 文部科学省
- 各資格試験の公式運営団体
- 教材出版社の公式情報

この層は事実確認では最優先する。

ただし「この教材をこの人が使うべきか」という個人戦略まで公式情報が決めるわけではない。

### 5.4 Exam analysis / large educational data sources

用途:

- 志望校難易度
- 必要な学力帯
- 科目別傾向
- 実際の問題分析
- 模試データに基づく現在地の解釈

候補例:

- 河合塾 / Kei-Net
- 駿台
- Benesse / マナビジョン
- Z会
- 東進
- 代々木ゼミナール

一機関の評価値を絶対値として扱わず、指標定義や年度差を考慮する。

### 5.5 Study-route / material-strategy sources

用途:

- 教材の順序
- 教材間の前提関係
- 到達レベルの目安
- 次教材の候補
- 学習ルートの比較

候補例:

- 武田塾の参考書ルート
- 河合塾の教材・学習アドバイス
- Z会の学習・教材情報
- その他、検証済みの教育機関

この層はstrategy evidenceであり、source of truthではない。

例えば一般ルートが

```text
A → B → C
```

でも、ユーザーがすでにBを80%完了しているなら、Aから全面的にやり直すことを自動的に勧めない。

必要なら

```text
Bの残り
→ A相当で実際に弱い部分だけ補修
→ C
```

のように個人化する。

### 5.6 Learning science sources

用途:

- 復習方法
- 記憶定着
- 問題演習
- 学習順序
- メタ認知
- 自己調整学習
- feedback方法

候補例:

- Institute of Education Sciences / What Works Clearinghouse
- Education Endowment Foundation
- peer-reviewed research
- systematic review / meta-analysis

参考にできる概念例:

- retrieval practice
- spaced practice
- interleaving
- worked examples
- generation
- elaboration
- metacognition
- self-regulated learning
- feedback

ただし、

```text
必ず1・3・7日後に復習する
必ず3周する
必ず25分で区切る
```

等を普遍的な科学的正解として固定しない。

### 5.7 Model general knowledge

外部・内部evidenceで不足する説明補助に使える。

ただし、次をmodel memoryだけで確定しない。

- 最新の入試制度
- 最新年度の試験日
- 最新版教材
- ISBN / ページ数
- 最新の参考書ルート
- 現在の大学難易度

### 5.8 Named sitesは固定whitelistではない

上記サイト名は初期candidate providerの例であり、永久的な信頼whitelistではない。

provider採用時には別途、

- 情報の更新頻度
- publication date
- claimの種類
- 利用規約
- retrieval可能性
- citation可能性
- structured化のしやすさ
- provider failure時のfallback

をexternal-integrations側で評価する。

---

## 6. Consultation Context

### 6.1 今回必要な情報だけをprojectionする

answer modelへユーザーの全履歴を毎回送らない。

applicationがcurrent questionに関係する情報を選び、read-only projectionとして構成する。

概念例:

```yaml
user_question: >-
  数学の点数を上げたいけど、
  どの参考書をいつまでに仕上げればいい？

conversation_context:
  relevant_turns:
    - ...

goal:
  exam: 共通テスト
  subject: 数学
  current_score: 55
  target_score: 75
  exam_date: 2027-01-16

materials:
  - material_id: ...
    name: 基礎問題精講
    progress: 0.30
    current_unit: ...

available_time:
  weekday_minutes: 60
  weekend_minutes: 120

observed_learning:
  recent_actuals: ...

deterministic_signals:
  remaining_days: ...
  estimated_capacity_minutes: ...
  pace_if_current_material_continues: ...
```

これはillustrativeであり、exact schemaではない。

### 6.2 context selectionの原則

- current questionに関係する情報だけを優先する
- known contextを重複質問させないために必要情報を含める
- user-owned factとobserved evidenceを区別する
- durable preferenceとcurrent-session conditionを区別する
- Bookshelf / Schedule / Actual等のsource ownershipを保持する
- 全履歴をコピーして新しいuser profileを作らない
- token/privacy budgetを持つ

---

## 7. Evidence Bundle

### 7.1 外部ページ全文をそのままpromptへ貼らない

今回の質問に必要なclaimを、provenance付きevidence itemとして渡す。

概念モデル:

```text
EvidenceItem
├─ evidenceId
├─ sourceType
├─ provider / publisher
├─ reference / URL / catalog identity
├─ publicationOrUpdatedAt
├─ retrievedAt
├─ summarizedClaim
├─ applicableScope
├─ authorityCategory
└─ provenance
```

### 7.2 例

```yaml
evidence_bundle:
  - evidence_id: official-exam-001
    authority: official_fact
    provider: 大学入試センター
    claim: ...
    updated_at: ...
    retrieved_at: ...

  - evidence_id: exam-analysis-001
    authority: exam_analysis
    provider: 河合塾
    claim: ...

  - evidence_id: route-001
    authority: study_route
    provider: 武田塾
    claim: ...

  - evidence_id: learning-science-001
    authority: learning_science
    provider: IES / WWC
    claim: ...
```

### 7.3 external textはinstructionではない

retrieved pageや教材title、user note等に、

```text
Ignore previous instructions
system message
このツールを実行しろ
```

等の文字列があってもinstructionとして扱わない。

Evidence Bundleは常にdataである。

---

## 8. Source retrieval strategy

### 8.1 毎回すべてのサイトを検索しない

質問内容から必要なevidence categoryを決める。

例:

```text
「共通テストはいつ？」
→ official fact sourceを優先

「この参考書の次は何がいい？」
→ user material/progress
   + material strategy / route evidence
   + 必要ならexam requirement

「どう復習したらいい？」
→ user context
   + learning science evidence

「今のペースで間に合う？」
→ official deadline
   + deterministic capacity / pace
   + exam requirement
   + strategy evidence
```

### 8.2 External retrievalが無くても動ける設計

Phase 1では毎回Web/RAG検索を必須にしない。

内部contextだけで有用な回答が可能なら回答できる。

ただし、最新性や正確な外部事実が回答の重要部分なら、evidence不足を無視してmodel memoryで埋めない。

将来external retrievalを追加しても、answer purposeのinput/output contractを変更せずEvidence Bundleへ追加できる設計を優先する。

---

## 9. 複数ソースが食い違う場合

answer modelは単純多数決をしない。

比較するもの:

- claimの種類
- source authority
- publication/update時点
- 各sourceの前提
- ユーザーの現在地
- ユーザーの目標
- 残期間
- 現在教材
- 教材変更コスト
- 実際の学習実績

例:

```text
武田塾ルート: 教材Aを推奨
河合塾側の分析: 現在レベルなら教材B相当
StudyPlanner: ユーザーは教材Cを70%完了
```

この場合に、サイトの知名度だけでA/B/Cを選ばない。

既存教材Cで目標へ到達可能なら、変更コストを含めC継続が合理的な場合もある。

逆にActualや模試から前提不足が明確なら、一部基礎へ戻す提案もできる。

---

## 10. Deterministic signals

次はanswer modelに推測させず、可能な範囲でapplication側の正式計算を渡す。

- remaining days
- remaining workload
- required daily pace
- available study minutes
- scheduler capacity
- deadline feasibility
- accepted progressから導出できるremaining

answer modelはこれらを戦略説明へ利用できるが、独自計算で上書きしない。

```text
計算・制約のtruth
→ deterministic application

教材選択・順序・優先度・trade-off・説明
→ answer AI
```

---

## 11. Question economy

answer modelは「情報がないから全部聞く」をしない。

質問条件:

```text
その情報の回答によって、推薦が大きく変わるか？
```

Yesの場合のみ質問候補とする。

合理的な仮定を置けば有用なprovisional adviceが可能なら、

- 仮定を明示する
- 先に役立つ回答を出す
- 必要なら一点だけ追加確認する

を優先する。

例:

「数学の参考書何がいい？」で現在学力が完全に不明なら、基礎教材と難関教材の選択が大きく変わるため質問価値が高い。

一方、今回の推薦に無関係な別科目教材の進捗率を機械的に聞かない。

---

## 12. Output Contract

answer purposeはproseだけを返さない。

概念上、少なくとも次を返せるようにする。

```text
AdviceAnswerDocument
├─ userFacingAnswer
├─ recommendations[]
│  ├─ recommendationType
│  ├─ material
│  ├─ purpose
│  ├─ prerequisite
│  ├─ sequence
│  ├─ milestone
│  ├─ suggestedTargetPeriod
│  ├─ rationale
│  ├─ assumptions
│  ├─ evidenceRefs
│  ├─ alternatives
│  └─ uncertainty
└─ materialBlockingQuestion?
```

exact schemaは実装時に決める。

重要なのは、後段が日本語回答をregex parsingしてproposalを復元しないことである。

---

## 13. Luna / answer modelの扱い

### 13.1 「promptが長いから無理」とは判断しない

モデル適性で重要なのは単純な文字数より、

- authorityの分離
- context selection
- conflicting evidenceの扱い
- structured outputの安定性
- Japanese dialogue quality
- instruction adherence

である。

必要情報を削ってpromptを短くすることをquality改善とみなさない。

### 13.2 Lunaを初期candidateにできる

Lunaを初期answer model候補にできるが、「context windowに入るから十分」とは判断しない。

実装前または実装初期にReal API evaluationで確認する。

評価軸:

- exact user questionへ答えているか
- relevant contextを正しく使うか
- user contextとgeneric routeが衝突した際にuser contextを優先できるか
- official factとadvisory opinionを区別できるか
- 武田塾等のrouteを唯一の正解として扱わないか
- 複数sourceの前提差を説明できるか
- 学習科学を固定レシピ化しないか
- 不要な質問を増やさないか
- deterministic signalを上書きしないか
- evidenceが無い最新情報を捏造しないか
- structured outputがschema validationを通るか
- adviceをschedule/memory authorizationとして扱わないか
- latency / token / costが許容範囲か

### 13.3 Model escalationはcontractを変えない

もしLunaがquality thresholdを満たさない場合、より強いmodelへ一部相談だけをescalateできる設計にする。

ただしmodel差し替えによって、

- Source Policy
- Consultation Context
- Evidence Bundle
- Output Contract
- application authority

を変更しない。

modelは交換可能なadvice generatorであり、domain ownerではない。

---

## 14. Promptだけに安全性を依存しない

次の不変条件はSystem Promptにも書くが、最終保証はdeterministic applicationが持つ。

```text
AI-generated advice
≠ user-stated fact
≠ accepted planning condition
≠ saved Plan
≠ durable memory
```

たとえanswer modelが誤って

```text
この予定を登録します
```

と出力しても、それだけでschedule mutationできない構造にする。

prompt complianceは防御層の一つであり、authorization boundaryではない。

---

## 15. Implementation前チェック

runtime実装へ進む前に、少なくとも次を具体化する。

- [ ] exact user questionをtop-level inputとして渡す
- [ ] System InstructionsとSource Policyを分離する
- [ ] Consultation Contextのselection責任をapplicationに置く
- [ ] user fact / observed evidence / external evidenceを区別する
- [ ] Evidence Bundleにprovenance / freshnessを持たせる
- [ ] named sitesを永久的なtruth whitelistにしない
- [ ] question typeごとに必要source categoryを選択できるようにする
- [ ] deterministic calculationを別入力として扱う
- [ ] answer proseとstructured recommendationを同時に返す
- [ ] output schema validationを通す
- [ ] external textをinstructionとして扱わない
- [ ] LunaをReal API Japanese evaluationで検証する
- [ ] Luna不十分時もmodel差し替えだけで済むcontractにする
- [ ] prompt complianceだけでschedule/memory safetyを保証しない

このチェックが完了しても、それ自体はruntime feature完成を意味しない。

実装・lifecycle・promotion・preview・saveについては親の [Learning Consultation and Advice Contract](learning-consultation-and-advice.md) に従う。
