# StudyPlanner 週間学習計画機能 計画書

## 1. この機能の目的

StudyPlannerの週間学習計画機能は、ユーザーが来週やりたい学習内容を、生活予定・移動・食事・睡眠・集中しやすい時間帯を考慮しながら、現実的な一週間の予定へ落とし込む機能である。

単に空いている時間へ課題を詰め込むのではなく、メンターのように対話しながら不足情報を確認し、ユーザーが実行しやすい形で予定を作ることを目的とする。

基本方針は次の通りである。

- 予定は最初から完全自動で確定しない
- 分からない情報は対話で確認する
- ただし、毎回細かく聞きすぎない
- 会話中と今回の計画では確認済みの生活サイクルや作業傾向を参照する。recurring profileへの昇格・永続化は明示同意を含む別設計とする
- 最終的には週表示・日表示に仮予定として可視化し、ユーザーが承認してから確定する

## 2. 全体の流れ

週間学習計画は、次の流れで作成する。

1. 既存予定と生活制約を取得する
2. ユーザーから今週の計画意図と学習goalを聞く
3. 現在のfactから生活アンカーとタスク実行特性の仮説を導出する
4. 不足情報の影響を評価し、安全な候補を先に提示する
5. 必要なfact、候補、仮定をユーザーの承認・差分修正で具体化する
6. hard required dimensionとavailability basisが揃ったかdeterministicに判定する
7. タスクを予定に入れられる単位へ分割し、所要時間と実行profileを見積もる
8. 過去実績や進捗から見積もりを補正する
9. まず6日分に均等配分する
10. 予定が多い日や空き時間が少ない日を調整する
11. ユーザーが仮予定作成を明示的に許可し、readinessがpreview_readyになった後だけ配置する
12. 週表示・日表示に仮予定として表示し、assumption metadataを付ける
13. ユーザーが確認・修正し、explicit UI approval後に本予定として確定する
14. 実施後に時間と進捗を記録し、以後の予定を再調整する

## 3. 第1項目: 6等分ベース再配分方式

週間計画は、原則として7日間のうち最初の6日で終わるように作る。

まず総作業量を6等分し、1日あたりの基準作業量を決める。これは人間が予定を立てるときの感覚に近く、最初から空き時間に比例して偏らせるより自然である。

例として、合計12時間の作業がある場合は、まず次のように置く。

```text
12時間 ÷ 6日 = 1日2時間
```

その後、既存予定や生活サイクルを見て、その日に基準作業量が入らない場合は減らす。減らした分は、予定が少ない日や空き時間が多い日に再配分する。

ただし、空いている日へ一気に詰め込みすぎないようにする。通常は、1日の割当量に上限を設ける。

```text
1日の通常上限 = 基準作業量 × 1.5
```

7日目は原則として予備日にする。1日目から6日目までに終わらなかった作業、後ろ倒しになった作業、急な予定変更で消えた作業を7日目に回す。

### まとめ

- 最初に6等分する
- 忙しい日だけ減らす
- 減らした分を余裕のある日に回す
- 空いている日にも詰め込みすぎない
- 7日目は原則として予備日にする

## 4. 第2項目: 生活プロファイルに基づく学習可能時間推定

学習可能時間は、一律の固定ルールで決めない。

予定の前後にどれくらい余裕が必要かは、人によって大きく違う。たとえば同じ「大学に行く」でも、家から大学に行く場合、大学からカフェに行く場合、すでに大学にいる場合では必要な時間がまったく異なる。

そのため、学習可能時間は次の情報をもとに推定する。生活イベントはbusy/freeだけでなく、帰宅後、食事前後、就寝前などの行動アンカーとしても参照する。ただし、アンカーは既存availabilityを増減させず、必要なbufferやconstraint変更は既存の仕組みを通す。

- 睡眠時間
- 食事時間
- 既存予定
- 移動時間
- 予定前後の余裕時間
- 曜日ごとの生活サイクル
- 勉強しやすい時間帯
- 勉強を入れたくない時間帯
- 過去の修正履歴

初回や不確実な予定では、チャット形式でユーザーに確認する。

例:

```text
この大学の予定は家から移動しますか？
前後にどのくらい余裕を見たいですか？
```

ただし、毎回聞くと負担になるため、同じconversationと今回の計画では確認済み内容を参照し、候補との差分だけを尋ねる。初期実装の仮説、未承認アンカー、pending proposalはsession-localであり、一度の発話から無期限profileへ自動保存しない。recurring profileへ昇格する場合は、明示同意、source、confidence、lastConfirmedAt、scope、保持期間、削除方法、矛盾時の優先規則を別途定める。

例:

```text
前回と同じく、大学予定の前後は移動込みで60分空ける前提にしています。
今回もこの扱いでよいですか？
```

### 保持する生活プロファイルの例

このJSONは将来のprofile表現例であり、今回のMVPで永続保存する契約ではない。

```json
{
  "sleep_patterns": {
    "default": {
      "bed_time": "01:00",
      "wake_time": "08:30"
    },
    "by_weekday": {}
  },
  "meal_patterns": {
    "lunch": {
      "default_time": "12:00-13:00",
      "flexible": true
    },
    "dinner": {
      "default_time": "19:00-20:00",
      "flexible": true
    }
  },
  "event_type_buffers": {
    "university": {
      "before_minutes": 60,
      "after_minutes": 45
    },
    "online": {
      "before_minutes": 15,
      "after_minutes": 15
    }
  },
  "study_preferences": {
    "preferred_time_ranges": ["15:00-18:00", "20:00-23:00"],
    "avoid_time_ranges": ["00:00-08:00"],
    "min_study_block_minutes": 30
  }
}
```

## 5. 第3項目: メンター対話型のタスク具体化

ユーザーが最初から完璧な情報を入力することは期待しない。

たとえばユーザーが「計算理論と英語を進めたい」とだけ言った場合でも、その発言からタスク候補を整理し、不足している情報だけを聞く。

確認する情報は次の通りである。

- 何をやりたいか
- どこからどこまでやるか
- 締切はあるか
- 今週中に終わらせたいのか、進めるだけでよいのか
- どのくらいかかりそうか
- ページ、問題、単元、工程などで分割できるか
- 順番に進める必要があるか
- 完了条件は何か

ただし、これらを一度にすべて聞くと負担が大きい。そのため、対話では一度に1から2問、多くても3問までにする。

質問は自由入力だけでなく、選択肢も使う。

例:

```text
計算理論はどの進め方に近いですか？

1. 過去問を年度ごとに進める
2. 苦手単元だけ復習する
3. 授業範囲を最初から順に復習する
4. まだ決まっていない
```

「分からない」も有効な回答として扱う。分からない場合は無理に決めさせず、仮置きまたは初日の試行予定として扱う。

### 行動文脈・仮説駆動の具体化

この機能では、質問を順番に埋めるだけでなく、現在のfactから次の計画仮説を作り、予定結果への影響が大きい不確実性だけを解決する。

- user explicit fact、deterministically derived fact、internal planning hypothesis、pending assumption proposal、accepted assumption fact、recurring profile memoryを別の証跡として扱う。
- 生活イベントはLifeActivityAnchorとして行動上の意味を持つが、既存のLifeConstraint、busy interval、buffer、existing plan、timetableを置き換えない。
- 既存availabilityへのPlanningOpportunityAnnotationで、夕食前の短い課題、夕食後の連続課題、就寝前の復習などの適合度を表す。annotationはavailabilityを新設・増減しない。
- StudyTaskScopeは何を進めるか、TaskExecutionProfileは暗記・演習・読解・重い課題などをどの分割・認知負荷で実行するかを表す。
- 安全な候補があれば自由回答の質問よりproposalまたはoptionを先に示し、目的そのもの、締切、候補間の影響が大きい事項だけmust_confirmとする。
- previewは、hard required dimension、配置可能なexecution shape、availability basis、高影響のblocking uncertainty、ユーザーの明示的な仮予定作成許可、state revision一致が揃ったときだけ生成する。assistantが提案しただけの段階、pending proposalが存在するだけの段階、resolved countだけでは生成しない。

仮説は予定block、preview、saved planではなく、deterministic coreが一時的に作るreviewableな材料である。AIはreadiness、suitability、deadline、availability、次の許可actionを計算せず、許可されたactionから自然な応答を選ぶ。

## 6. 質問しすぎ防止ルール

この機能では、ユーザーに聞きすぎないことが非常に重要である。

質問するかどうかは、次の考え方で決める。

```text
質問するべき度 = 間違えた時の影響 × 不確実性 - 質問コスト
```

たとえば、移動時間が不明な場合は、予定が大きく変わる可能性があるので聞く。一方で、夕食を19:00にするか19:30にするかのような細かい違いは、仮置きして最後に確認すればよい。MissingResolutionModeはderive_deterministically、propose_default、offer_options、must_confirmの有限分類とし、MissingResolutionOpportunityのimpactとuncertaintyで候補提示か質問かを決める。

### 質問する条件

- 予定全体が30分以上変わる可能性がある
- 締切に影響する
- 学習可能時間が大きく変わる
- 初めて出てきた予定種別である
- 過去の記憶と矛盾している
- 前回その時間帯の予定が削除された
- 計画が過密になりそう

### 質問しないで仮置きする条件

- 影響が小さい
- 過去のメモリから高い信頼度で推定できる
- 後から簡単に変更できる
- 最終確認でまとめて承認を取れば十分である

## 7. 第4項目: 所要時間、実績時間、進捗率による補正

タスクの所要時間は、ユーザーの自己申告をそのまま使うのではなく、過去実績や課題タイプに基づいて補正する。

特に、次の2つを分けて扱う。

### 見積もりが甘い場合

```text
予定: 2時間
実績: 4時間かかって完了
```

これは、タスクの見積もりが甘かった状態である。

この場合は見積もり補正係数を更新する。

```text
見積もり補正係数 = 実際にかかった時間 ÷ ユーザーの予想時間
```

### 予定を実行できなかった場合

```text
予定: 2時間
実績: 30分しかやらなかった
```

これは、所要時間の問題ではなく、予定実行率の問題である。

この場合は、その時間帯や課題タイプの実行率を下げる。

```text
予定実行率 = 実際に勉強した時間 ÷ 予定していた勉強時間
```

見積もり補正と予定実行率を混ぜないことが重要である。

## 8. 進捗記録

予定の実績記録では、実施時間だけでなく進捗も記録する。

実施時間だけでは、残り時間を再計算できないためである。

例:

```text
90分やった
全体の30％まで進んだ
```

この場合、残り70％に対してどれくらい時間がかかるかを推定できる。

進捗は細かく入力させすぎない。基本は、予定記録の画面で進捗バーを動かして入力できるようにする。

進捗バーでは、タスク全体の現在位置を表す。今日の予定の達成率ではなく、その課題全体がどこまで進んだかを示す。

### 入力例

- 完了
- 75％くらい
- 半分くらい
- 25％くらい
- ほぼ進まなかった

または、ページ数・問題数・単元名で答えられる場合は、それを内部で進捗率に変換する。

### 予定カードに記録する情報

- 予定時間
- 実績時間
- 予定上の進捗開始位置
- 予定上の進捗終了位置
- 実際の進捗開始位置
- 実際の進捗終了位置
- 体感の重さ
- 任意メモ

## 9. 第5項目: 作業を実行しやすい予定ブロックへ配置する

各日の学習可能時間とタスクの割当量が決まったら、実際の空き時間帯へ学習ブロックとして配置する。

配置では、次の要素を考慮する。

- 長めの空き枠を優先する
- ユーザーが集中しやすい時間帯を優先する
- 課題の種類に合う時間帯を選ぶ
- 短い空き時間には軽い課題を入れる
- 卒研、レポート、過去問など重い課題はまとまった枠に入れる
- 同じ課題は原則として順番を守る
- 複数課題がある場合は週全体で偏りすぎないようにする
- 長時間の学習には休憩を挟む

### 休憩ルールの例

- 30分未満: 休憩なし
- 30から60分: 休憩なし、または終了後に短休憩
- 60から120分: 50分作業 + 10分休憩
- 120分以上: 50分作業 + 10分休憩を繰り返す
- 2セットごとに20から30分の長め休憩

## 10. 第6項目: カレンダー上の仮表示と承認

作成した予定は、テキストだけで提示しない。

既存の1週間表示・1日表示に、AIが作成した学習予定を仮予定として表示する。

週表示では、次の点を確認できるようにする。

- 日ごとの負荷の偏り
- 課題の偏り
- 日曜が予備日になっているか
- 既存予定とのバランス

1日表示では、次の点を確認できるようにする。

- 授業や予定の直後すぎないか
- 休憩が入っているか
- 夜遅すぎないか
- 重い課題が短すぎる枠に入っていないか

AIが提案した予定は、既存予定と見分けられるようにする。

例:

- 薄い色で表示
- 点線枠で表示
- 「AI提案」ラベルを付ける
- 承認前は仮予定として扱う

ユーザーは、仮予定を見ながら次の方法で修正できる。

- ドラッグで移動
- 長さを変更
- 削除
- 別日に移動
- チャットで指示する

承認後に本予定として確定する。preview表示と保存は別操作であり、pending assumptionを使用したpreviewはreviewableでもsaveできない。仮定のaccept/modify後はstate revisionを進め、最新条件で再計算したpreviewだけを承認対象とする。

## 11. 再計画

予定作成後も、実績や変更に応じて再計画する。

再計画が必要になる条件は次の通りである。

- 新しい予定が追加された
- 既存予定が変更された
- AIが作った勉強予定が削除された
- 予定時間と実績時間が大きくずれた
- 予定していた進捗に届かなかった
- 予定より早く終わった
- 締切までに終わらない見込みになった
- 1日目の試行予定の結果が登録された

AIが作った予定が削除された場合、毎回理由を聞くと負担になる。次のような場合だけ理由を聞く。

- 30分以上の学習予定が削除された
- 削除によって締切に影響する
- 同じ種類の予定が繰り返し削除されている

理由は選択式にする。

例:

- 疲れていた
- 別の予定が入った
- 予定量が多すぎた
- 時間帯が合わなかった
- 課題の優先度が下がった
- 既に別の時間に終わらせた
- その他

## 12. AI と deterministic core の責務分離

LLMは自然文の意味解釈、typed candidate候補、dialogue plannerの有限action/responseParts候補、事実値を含まない短い接続文を担う。LLMは日付・時刻・容量・配置・fact ID・formatter ID・state revision・proposal lifecycle ID/status・proposal理由の自由文・readiness・suitability score・deadline・availability・承認・保存・削除を決めない。

### LLMを使う部分

- single AI interpreterによる自然文からのtyped candidate抽出
- DialogueStateSnapshotとAllowedDialogueActionsに基づく有限actionの選択
- responsePartsとしてfact/question/option参照を選ぶこと
- deterministic coreが生成したPlanningHypothesisSnapshotとAllowedDialogueActionsから、proposal-firstまたはrequired questionの許可actionを選ぶこと
- PendingAssumptionProposalDraftの候補化（有限なAssumptionProposalReasonCodeを含み、reasonTextは含めない）
- acknowledgement、transition、empathy、instruction、closingに限定した短いfree text

AI responseで使用fact/topic/optionを表す正はresponsePartsだけとし、factRefsやquestionTopicsを二重申告させない。free textには日時、時間量、件数、タイトル、期間等の事実値を含めず、事実はfact partからdeterministicに描画する。proposal理由もreasonTextで迂回させず、reasonCode、slot、proposed value、public source facts、target public fact、formatter registryからdeterministic response partsを生成する。unknown code、slot非互換、private/stale source、reasonTextを含むdraftはproposal全体をrejectする。

### deterministic coreで処理する部分

- AI出力後のtyped candidate normalization（日付、時刻、値の正規化）
- command AST / IRのshape、enum、値域、source fact、revision検証
- accepted commandのcompile、adapter、reducer、accepted/rejected/pendingのstate transition
- PendingAssumptionProposalDraftのreasonCode/slot/sourceを検証してAssumptionProposalRecordを生成し、resolvedByを含むlifecycle historyを保持すること
- LifeActivityAnchor、TaskExecutionProfile、PlanningOpportunityAnnotation、PlanningReadinessSnapshot、PlanningHypothesisSnapshotの導出
- StudyTaskScope → GenericWeeklyWorkItem、assumptionProposalRef、existing events、availability、busy interval、required/available/scheduled/unscheduled、scheduler、preview
- responsePartsのcompile、public fact/formatter registry、action/topic/option/factRef validator
- responsePartsからusedFactRefs、usedQuestionTopicIds、usedOptionIdsを導出すること
- relative dateの一意解決、correction target/decision、関連pending proposalのatomicなsupersede/expire、preview stale化
- stale request/revision、fallback、approval/save/delete、idempotency、localStorage/migration

通常provider経路でdeterministic parserがuserTextをsemantic clause解析してAI結果とmergeすることはしない。rules fallback時だけ既存deterministic parserがuserTextを解釈する。interpreter failureはturn-wide rules fallback、planner failureはaccepted stateを保持したdeterministic renderer fallback、StaleAsyncResultは無言で破棄する。StalePreviewApprovalAttemptは保存を拒否して再計算または最新案確認を案内し、PendingAssumptionPreviewApprovalAttemptは現在revisionのpreviewに残るpending assumptionの確認を案内する。後二者はいずれもdeterministic user-facing rejectionで、AI call、approval ledger作成、repository saveを行わない。empty candidatesは正常なinterpreter結果でありfailureではない。

## 13. この機能の最終方針（v4最終整合版）

週間計画はsingle AI interpreterと、検証済みstate/計算結果を根拠に次のactionを選ぶdialogue plannerの二段階で設計する。通常turnは最大2 AI call、openingは最大1 callとし、十分なdeterministic openingではAIを呼ばない。

受理済み事実、AssumptionProposalRecord履歴、PendingAssumptionProposal view、訂正履歴、拒否理由、asked topic、active question、planning range、既存予定、空き時間、feasibility、WeeklyPreviewMetadata（assumptionDependenciesとapprovalEligibilityを含む）を構造化stateとして保持する。全user-originated stringはuntrusted JSON dataであり、内部命令やIDに昇格させない。accepted correctionは同じdeterministic transitionで関連pending proposalをsupersededまたはexpiredへ解決し、resolvedByと決定revisionを記録する。履歴は残し、pending viewから除外し、旧proposalへのdecisionを拒否する。

一意解決できる「来週」はselected dateからdeterministicにrange化し、同じplanning periodを再質問しない。曖昧な相対表現だけclarificationへ倒す。

previewはstateRevision/previewIdに束縛された未承認draftである。pending assumptionを使うpreviewは表示できるが、使用proposalをassumptionDependenciesへ全件記録し、status=pendingが一件でもあればapprovalEligibility=blocked_pending_assumptionとして保存できない。preview承認をaccept_assumptionへ暗黙変換しない。assumptionのaccept/modifyはrevisionを進めて旧previewをstaleにし、accepted factで再計算した最新previewだけをeligibleにできる。保存境界でrevisionとproposal statusを再検証し、stale、pending、rejected/expired/superseded dependencyをUI表示だけに頼らず拒否する。approval idempotencyはuserId + sourceDraftBlockIdをkeyとし、approvalOperationIdは監査metadataに限定する。approval item ledgerでpartial failure/crash/retryを扱う。AIはapproval operationを起動しない。

current queueはv4とroadmap冒頭Current queueだけが正である。Gate P4（active verification gate）→ DA0a（blocked）→ DA0（blocked）→ DA1 → DA1b → Draft approval idempotency → DA2 → DA3a → DA3b → DA3c（queued）の順である。Gate P4完了前にopen implementation taskはなく、旧P4〜P9、T6、D1〜D7、v3 stageはhistorical/supersededである。

試験はP1〜P7 caseと必須18 Requirement IDのcanonical traceability tableを正とし、golden text完全一致ではなくstrict contractと会話品質rubricで判定する。

### v4 amendmentの最終原則

現在のfactから安全な計画仮説を作り、候補がある不足情報は先に提案する。生活アンカーとタスク実行profileは配置理由を改善するが、既存availabilityやhard constraintを上書きしない。仮説、仮定、仮予定、確定予定を別物として扱い、readinessとuser_authorizedの両方が揃うまでpreviewを生成しない。
