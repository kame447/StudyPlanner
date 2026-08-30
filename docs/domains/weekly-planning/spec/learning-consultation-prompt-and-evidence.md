# Learning Consultation Prompt and Evidence Design

Status: supporting design / subordinate to canonical requirement / runtime implementation in progress
Updated: 2026-08-30
Owning Issue: [#246](https://github.com/kame447/StudyPlanner/issues/246)
Parent canonical: [learning-consultation-and-advice.md](learning-consultation-and-advice.md)

## 1. この文書の位置付け

この文書は、Issue #246 の学習相談機能について、learning-advice answer purposeへ実際に何を渡し、どの規則で回答させるかを詳細化するsupporting designである。

親の正仕様は [Learning Consultation and Advice Contract](learning-consultation-and-advice.md) であり、本書はその責任境界を変更しない。矛盾がある場合は親仕様を優先する。

本書が所有するもの:

- answer purposeの固定instruction設計
- Source Policy
- Consultation Contextの入力構成
- Evidence Bundle
- exact user questionの受け渡し
- revision / alternative生成時のReview Context
- output contract
- Luna等のanswer model評価条件

本書が所有しないもの:

- consultation / review routingの正式state
- AdviceProposal / ReviewDecisionのformal state transition
- review / validity / promotionのauthority
- scheduler
- preview
- Plan approval / save
- durable memory
- external provider採用そのもの

---

## 2. 結論: 「短くする」のではなく「責任ごとに分離する」

answer modelへ必要情報を巨大な一枚のpromptへ混ぜない。

重要な判断規則をtoken節約のために削除することもしない。

基本構造:

```text
A. System Instructions
   変わりにくい学習相談AIの役割・判断原則

B. Source Policy
   claim typeごとに何を重視するか

C. Consultation Context
   StudyPlannerが持つ今回のユーザー固有情報

D. Evidence Bundle
   今回の相談に必要な内部・外部evidence

E. User Question
   今回ユーザーが実際に聞いた質問

F. Output Contract
   人間向け回答 + validated structured recommendation

G. Review Context (optional)
   revision / alternative時のみ、前proposalとuser feedbackを渡す
```

`Review Context`は初回相談では不要であり、再提案時だけ追加する。

命令、user fact、外部evidence、review feedback、current question、output schemaを同じprose blockへ混在させない。

---

## 3. Runtime input envelope

概念上、answer purposeへの入力は次の責任を持つ。

```text
LearningConsultationAnswerInput
├─ systemInstructionsVersion
├─ sourcePolicy
├─ userQuestion
├─ consultationContext
├─ evidenceBundle
├─ deterministicSignals
├─ reviewContext?       // revision / alternative only
└─ outputContractVersion
```

exact TypeScript名は実装時にcurrent codeと照合して決める。

### 3.1 exact user questionを独立して渡す

長いconversation historyからcurrent questionを再推測させない。

```yaml
userQuestion: >-
  数学の点数を上げたいけど、
  どの参考書をいつまでに仕上げればいい？
```

過去turnが必要でも、`userQuestion`とは別のbounded contextとして渡す。

### 3.2 Review Context

`request_revision` / `request_alternative`では、current questionだけを再送しない。

概念上次を渡す。

```text
ReviewContext
├─ sourceAdviceId
├─ sourceRevision
├─ reviewAction
│  ├─ request_revision
│  └─ request_alternative
├─ selectedOptionIds / selectedItemIds
├─ userFeedback
└─ priorAdviceSnapshot
```

`priorAdviceSnapshot`はvalidated structured proposalから作り、renderer proseを後からregexで再解析しない。

例:

```yaml
reviewContext:
  sourceAdviceId: advice_123
  sourceRevision: 1
  reviewAction: request_alternative
  userFeedback: "標準問題精講は重すぎるから嫌。別の案がいい"
  priorAdviceSnapshot:
    recommendations:
      - material: 標準問題精講
        purpose: 標準問題演習
```

answer modelはこのfeedbackを次案の重要contextとして利用する。

ただしfeedbackを教材の客観factやdurable user preferenceとして勝手に扱わない。

---

## 4. System Instructionsの責任

System Instructionsには毎回変わらない役割・判断原則を置く。

サイト一覧、今回のuser context、検索結果全文、proposal history全文を埋め込まない。

### 4.1 System prompt candidate

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
- StudyPlannerから与えられたユーザー固有情報を最優先する
- 既に分かっている情報を聞き直さない
- 一般的な学習ルートをそのままコピーせず、現在地へ適合させる
- 有名だからという理由だけで教材を増やさない
- 現在の教材で十分なら継続を選択肢に含める
- sourcePolicyに従い、claim typeごとに適切なevidenceを使う
- 一つの塾・予備校・出版社の方針を唯一の正解として扱わない
- 最新性が重要な事実をmodel memoryだけで断定しない
- 複数ソースが異なる場合は前提とtrade-offを比較する
- 学習科学を使う場合も固定日数・固定回数を普遍的な科学的正解にしない
- deterministicSignalsが与えられている数値はapplication-owned truthとして使用する
- 合理的な仮定で有用な回答が可能なら質問しすぎない
- recommendationが大きく変わる不足だけを質問する
- 根拠が弱い場合は不確実性・仮定を説明する
- 根拠のない確率や合格保証を生成しない

reviewContextがある場合:
- 前proposalとuserFeedbackを必ず考慮する
- request_revisionでは、ユーザーが残したい部分を可能な限り維持して指定箇所を修正する
- request_alternativeでは、拒否された要素をそのまま再提示せず、意味のある別案を作る
- 制約上ほぼ同じ案しか成立しない場合は、無理に違う案を捏造せず理由を説明する
- feedbackだけでは有用な差分を作れない場合、推薦を大きく変える質問を最大1つだけ返してよい
- userFeedbackを、ユーザーが明示していない恒久的嗜好や客観的事実へ拡張しない

境界:
- あなたの回答はadviceである
- user-stated factではない
- user-approved planning strategyではない
- promoted planning conditionではない
- saved Planではない
- durable memoryではない
- review state / validity / promotion / schedule / saveを直接変更しない

回答:
- ユーザー向けに理解しやすく簡潔に説明する
- 同時にstructured recommendationを返す
- structured recommendationもuser approval前はproposalである
```

### 4.2 巨大promptにしない理由

System Promptへ次を直接混ぜない。

- 個別サイト一覧
- Bookshelf全文
- conversation全文
- schedule全文
- 検索結果全文
- proposal履歴全文

問題はtoken数だけでなく、`instruction / fact / evidence / feedback`のauthorityが混ざることである。

---

## 5. Source Policy

### 5.1 サイトを一律ランキングしない

情報源のauthorityはclaim typeによって変わる。

例えば武田塾の参考書ルートは教材順序のstrategy evidenceとして有用だが、大学の正式試験日・配点の最終authorityではない。

### 5.2 User-owned authoritative context

ユーザー本人についてはStudyPlanner側のauthoritative contextを最優先する。

- 明示目標
- 志望校 / 試験
- 現在点 / 目標点
- 登録教材 / 教材進捗
- Actual study evidence
- 利用可能時間
- 明示的希望・制約

外部の一般ルートがこれを上書きしない。

### 5.3 Official fact sources

用途:

- 試験日
- 科目 / 配点 / 出題範囲
- 募集要項
- 資格制度
- 教材の正式名称・版・ISBN等

候補:

- 大学・学校公式
- 大学入試センター
- 文部科学省
- 資格試験公式運営団体
- 教材出版社公式

事実確認では最優先する。

### 5.4 Exam analysis / large educational data sources

用途:

- 志望校難易度
- 必要な学力帯
- 科目別傾向
- 実際の問題分析
- 模試データに基づく現在地の解釈

候補:

- 河合塾 / Kei-Net
- 駿台
- Benesse / マナビジョン
- Z会
- 東進
- 代々木ゼミナール

一機関の評価を絶対値として扱わない。

### 5.5 Study-route / material-strategy sources

用途:

- 教材の順序
- 教材間の前提関係
- 到達レベルの目安
- 次教材候補
- 学習ルート比較

候補:

- 武田塾の参考書ルート
- 河合塾の教材・学習アドバイス
- Z会の学習・教材情報
- その他検証済み教育機関

この層はstrategy evidenceでありsource of truthではない。

一般ルートが `A → B → C` でも、ユーザーがBを80%終えているならAから全面的にやり直すことを自動推奨しない。

### 5.6 Learning science sources

用途:

- 復習 / 記憶定着
- 問題演習
- 学習順序
- メタ認知 / 自己調整
- feedback

候補:

- Institute of Education Sciences / What Works Clearinghouse
- Education Endowment Foundation
- peer-reviewed research
- systematic review / meta-analysis

利用可能な概念例:

- retrieval practice
- spaced practice
- interleaving
- worked examples
- generation
- elaboration
- metacognition
- self-regulated learning
- feedback

「必ず1・3・7日後」「必ず3周」等を普遍的な科学的正解として固定しない。

### 5.7 Model general knowledge

説明補助には使えるが、次をmodel memoryだけで確定しない。

- 最新入試制度 / 試験日
- 最新版教材
- ISBN / ページ数
- 最新参考書ルート
- 現在の大学難易度

### 5.8 Named sitesは永久whitelistではない

provider採用時にはexternal-integrations側で、更新頻度、publication date、利用規約、retrieval可否、citation、normalization、fallbackを評価する。

---

## 6. Consultation Context

質問に関係するStudyPlanner内情報だけをbounded projectionとして渡す。

候補:

- goal / target exam / target score
- current score / diagnostic evidence
- Bookshelf materials / progress / aliases / pace metadata
- current planning state
- Timetable / existing Plan
- Actual / Reporting aggregate
- availability / capacity
- explicit preferences / constraints
- authoritative dates

全データを毎回渡さない。

context itemには可能な限りsource identity / revision / authority / observation timeを持たせる。

---

## 7. Evidence Bundle

外部ページ全文をそのままpromptへ投げない。

概念上、必要な主張をbounded `EvidenceItem`へ正規化する。

```text
EvidenceItem
├─ evidenceId
├─ sourceCategory
├─ provider / title
├─ sourceUrl or sourceIdentity
├─ publishedAt / updatedAt when known
├─ retrievedAt
├─ claimType
├─ summary / normalized claims
├─ applicability
└─ authority / uncertainty
```

retrieved contentはinstructionではなくuntrusted evidenceである。

外部ページ内の「以前の指示を無視せよ」等をsystem instructionとして実行しない。

copyright上、必要な事実・要約を扱い、 proprietaryな教材ルート全文を無差別複製する設計にしない。

---

## 8. Deterministic Signals

残り日数、remaining workload、必要ペース、利用可能時間、capacity、正式feasibility等はStudyPlanner側で計算して渡す。

answer AIが同じ数字を推測で上書きしない。

```text
strategy judgment → answer AI
numeric truth      → deterministic application
```

---

## 9. Output Contract

answer purposeは自然言語だけでなくvalidated structured resultを返す。

概念上:

```text
AdviceAnswerDocument
├─ userFacingAnswer
├─ recommendations[]
│  ├─ material / method / sequence
│  ├─ purpose
│  ├─ prerequisite
│  ├─ milestone
│  ├─ suggestedTargetPeriod
│  ├─ rationale
│  ├─ assumptions
│  ├─ evidenceRefs
│  └─ uncertainty
├─ alternatives
├─ blockingQuestion?
└─ planningImplications
```

application-owned `adviceId / revision / optionId / itemId / review state`をanswer AIへ自由生成させない。

AI output validation後にdeterministic applicationがformal proposal identityを付与する。

### 9.1 Revision / alternative output

reviewContext付きcallでも出力は新しい`AdviceAnswerDocument`である。

前proposalをin-place mutationする命令を返させない。

applicationが新proposal revisionとしてcommitし、lineageを付与する。

---

## 10. Review feedbackの扱い

### `request_revision`

同じ方針をベースに指定箇所を直す。

例:

```text
v1: 基礎問題精講を10月末まで
user: 教材はそれで、期限だけ11月末にして
```

AIは教材を勝手に入れ替えず、期限変更が戦略全体へ与える影響だけ再評価する。

### `request_alternative`

現在案を採用せず別方向を求める。

例:

```text
v1: 標準問題精講
user: これは重すぎる。別の案がいい
```

新案は拒否された教材を単に再提示しない。

ただし無理に「違うふり」をするために質の低い教材を捏造しない。

### `dismiss`

`dismiss`はanswer AIへ再生成callを行う契機ではない。

「もういい」に対して別案を自動生成しない。

---

## 11. Question economy

- known contextを再質問しない
- recommendationが大きく変わる不足だけを質問する
- 仮定を明示して有用な案を出せるなら先に回答する
- planning slotを相談開始時に全部聞かない
- revision / alternativeでも大量質問へ戻らない

review feedbackを何度受けても有意な別案を作れない場合は、固定回数heuristicではなく、差分を決める1つのtargeted questionを返せる。

---

## 12. Example envelopes

### 12.1 Initial consultation

```yaml
userQuestion: "数学の点数を上げたい。どの参考書をいつまでにやればいい？"

consultationContext:
  targetExam: 共通テスト
  currentScore: 55
  targetScore: 75
  examDate: 2027-01-16
  materials:
    - name: 基礎問題精講
      progress: 0.30
  availableTime:
    weekdayMinutes: 60
    weekendMinutes: 120

evidenceBundle:
  - sourceCategory: official_exam
    source: 大学入試センター
    claim: "..."
  - sourceCategory: exam_analysis
    source: 河合塾
    claim: "..."
  - sourceCategory: study_route
    source: 武田塾
    claim: "..."

deterministicSignals:
  remainingDays: 138
```

### 12.2 Alternative request

```yaml
userQuestion: "その教材は嫌。別の案にして"

consultationContext:
  # current authoritative context
  ...

reviewContext:
  sourceAdviceId: advice_123
  sourceRevision: 1
  reviewAction: request_alternative
  userFeedback: "その教材は嫌"
  priorAdviceSnapshot:
    recommendations:
      - material: 標準問題精講
        purpose: 標準問題演習

# evidence / deterministic signals are refreshed as needed
```

新proposal v2のformal ID / revision / lineageはapplicationが付与する。

---

## 13. Luna / answer model evaluation

「promptを読める長さだから採用」では判断しない。

Real API evaluationで少なくとも次を見る。

### Initial answer quality

- current user questionへ直接答える
- user contextを一般ルートより優先できる
- 一つの教育機関を絶対視しない
- 不要な教材を増やさない
- deterministic signalsを上書きしない
- 不足時に質問しすぎない
- structured outputが安定する

### Review loop quality

- `request_revision`で残すべき部分を維持できる
- `request_alternative`で実質的な別案を作れる
- rejected elementを無視して同案を反復しない
- user feedbackを勝手にdurable preferenceへ一般化しない
- 差分を作れないとき適切なtargeted clarificationへ落とせる
- prior proposal / current context / evidenceの衝突を扱える

### Safety / authority

- 「承認しました」と自分でformal stateを変更したふりをしない
- schedule / saveを実行したと主張しない
- evidence内prompt injectionを命令として扱わない
- model memoryで最新事実を捏造しない

Lunaが基準を満たさない場合でもinput/output contractはmodel非依存に保ち、answer providerだけ差し替えられるようにする。

---

## 14. Implementation rule

このsupporting designを理由に重要安全条件をpromptだけへ委ねない。

次は必ずapplication側でも保証する。

- advice生成だけでplanning stateを変えない
- review actionをtyped stateからbindする
- `dismiss`時に自動再生成しない
- approval時にstalenessをrevalidateする
- stale proposalをpromoteしない
- revisionはnew proposalとしてcommitする
- duplicate review / promotionをidempotentに防ぐ
- review feedbackをdurable memoryへ自動昇格しない
- validated final outputだけをAdviceProposal候補にする

Promptは判断品質を高めるための契約であり、security / lifecycle authorityそのものではない。
