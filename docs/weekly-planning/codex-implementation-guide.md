# Codex向け実装指示 v2: StudyPlanner 週間学習計画機能

## 0. この文書の目的

この文書は、StudyPlannerに「メンター対話型の週間学習計画機能」を実装するためのCodex向け指示である。

v2では、機能要件だけでなく、非機能要件、想定される問題と対策、ユーザーに追加確認すべき事項、既存AI入力欄をChatGPT風の会話UIに拡張する方針も含める。

実装時は、この文書を仕様の起点として扱う。ただし、未決事項は勝手に決め切らず、「ここからはユーザーに聞く」と明記された項目については、実装前または実装中にユーザーへ確認すること。

---

## 1. 実装目的

StudyPlannerに、ユーザーと対話しながら来週の学習予定を作成する機能を追加する。

ユーザーが来週やりたいことを雑に入力すると、AIがメンターのように不足情報を確認し、既存予定、生活サイクル、移動、食事、睡眠、過去の学習実績を考慮して、一週間の学習予定を作成する。

生成された予定は、すぐに確定せず、既存の週表示・日表示に「仮予定」として可視化する。ユーザーが確認、修正、承認した後に本予定として確定する。

---

## 2. UI方針

### 2.1 既存AI入力欄をChatGPT風の会話UIにする

現在のAI入力欄は、単発の自然文入力欄として扱うのではなく、ChatGPTのような会話形式に近づける。

ユーザーは、計画作成中に以下のようなやり取りができる。

```text
ユーザー:
来週、計算理論と英語と卒研を進めたい

AI:
了解です。まず計算理論は、過去問を進める感じですか？
それとも授業範囲の復習ですか？
```

このように、AIが一度に全部聞くのではなく、必要なことを少しずつ確認する。

### 2.2 通常AI入力と週間予定作成を切り替えられるようにする

AI入力欄には、少なくとも以下のモードを用意する。

```text
通常相談モード
週間予定作成モード
```

または、より自然な名前として次のようにしてもよい。

```text
相談
週間計画
```

週間予定作成モードでは、会話の状態を保持する。

```ts
type AiInputMode = "chat" | "weekly_planning";
```

通常相談モードでは、既存のAI入力機能を維持する。週間予定作成モードでは、PlanningStateに沿って質問、仮予定作成、承認、再計画を行う。

### 2.3 週表示・日表示への仮予定表示

週間予定作成モードで作成した予定は、テキストだけで返さず、既存の週表示・日表示に仮予定として表示する。

仮予定は既存予定と見分けられるようにする。

候補:

```text
薄い背景色
点線枠
AI提案ラベル
仮予定ラベル
承認前バッジ
```

ユーザーは、仮予定を見ながらドラッグ、長さ変更、削除、チャット指示で調整できるようにする。

---

## 3. 機能要件

### 3.1 対話による週間計画作成

ユーザーが来週やりたいことを入力すると、AIはタスク候補を抽出する。

抽出する情報:

```text
タスク名
カテゴリ
範囲
締切
見積もり時間
分割単位
順序制約
完了条件
不明点
```

不足情報がある場合は、AIが対話で確認する。

ただし、すべてを一度に聞かない。1ターンの質問は原則1から2個、多くても3個までとする。

### 3.2 6等分ベース再配分

週間計画は、原則として7日間のうち最初の6日で完了するように作成する。

```ts
const baseDailyMinutes = totalEstimatedMinutes / 6;
```

1日目から6日目に基準作業量を仮割当し、各日の学習可能時間に入らない場合だけ減らす。

減らした分は、余裕のある日に再配分する。

7日目は原則予備日とする。1日目から6日目に入らない分、未完了分、後ろ倒し分のみ7日目へ入れる。

### 3.3 生活プロファイルに基づく学習可能時間推定

一律の固定ルールではなく、ユーザーの生活サイクル、曜日ごとの習慣、移動、食事、睡眠、予定前後の余裕時間を使って学習可能時間を推定する。

初回や不明な予定ではユーザーに確認する。過去に確認済みの内容はメモリとして使い、最後にまとめて承認を取る。

### 3.4 タスク分割

タスクカテゴリに応じて自然な分割単位を提案する。

例:

```text
過去問: 年度、大問、分野
参考書: ページ、章、節
レポート: 資料収集、構成、本文、推敲、提出確認
卒研: データ確認、ラベリング、分析メモ、整理、報告準備
英語: 問題数、単元、ページ
暗記: 語数、カード数、範囲
```

分割単位が不明な場合は、AIが候補を提示して選ばせる。

### 3.5 所要時間補正

タスクの所要時間は、ユーザーの自己申告をそのまま使わず、過去実績と課題カテゴリから補正する。

見積もり補正と予定実行率は分けて扱う。

```ts
estimateBias = actualCompletionMinutes / userEstimatedMinutes;
scheduleAdherence = actualStudyMinutes / plannedMinutes;
```

所要時間が不明な場合は、無理に一週間分へ割り振らず、初日に試行予定を入れる。

### 3.6 進捗記録

学習予定の実績記録では、実施時間だけでなく進捗も記録する。

進捗は予定カード内で記録できるようにする。別画面へ分離しすぎない。

入力項目:

```text
実際にやった時間
進捗バー
体感の重さ
任意メモ
```

進捗バーは、今日の予定達成率ではなく、タスク全体がどこまで進んだかを表す。

### 3.7 仮予定表示と承認

AIが作成した予定は、週表示・日表示に仮表示する。

仮予定は承認されるまで本予定として保存しない。

ユーザーは次の操作ができるようにする。

```text
承認
すべて破棄
個別削除
ドラッグ移動
長さ変更
チャットで修正指示
```

### 3.8 再計画

次の場合に再計画を行う。

```text
新しい予定が追加された
既存予定が変更された
AI生成の学習予定が削除された
予定時間と実績時間が20％以上ずれた
予定進捗と実績進捗が大きくずれた
締切までに終わらない見込みになった
試行予定の結果が登録された
```

AI生成予定が削除された場合、常に理由を聞かない。30分以上の予定削除、締切影響あり、同じ種類の予定が繰り返し削除される場合だけ理由を聞く。

---

## 4. 非機能要件

### 4.1 使いやすさ

この機能は、正確さだけでなく「ウザくないこと」を重視する。

要件:

```text
質問を一度に投げすぎない
1ターンの質問は原則1から2個
多くても3個まで
選択肢を出して答えやすくする
分からない、を有効な回答として扱う
細かいことは仮置きし、最後にまとめて確認する
```

### 4.2 説明可能性

なぜその予定を入れたのか、ユーザーが理解できるようにする。

例:

```text
月曜は大学後なので、すぐには入れず20:00からにしました。
卒研は90分以上のまとまった枠に入れています。
日曜は予備日にしています。
```

すべてを長文で説明する必要はない。必要なときに見られる程度でよい。

### 4.3 応答速度

計画作成時に毎回LLMへ大量の履歴を送らない。

通常コードで処理できるものはコードで処理する。

コードで処理するもの:

```text
空き時間計算
睡眠、食事、バッファ除外
6等分
再配分
配置スコア
休憩挿入
進捗率計算
再計画条件判定
```

LLMを使うもの:

```text
自然文からタスク候補を抽出
曖昧なタスクの分割候補生成
自然な質問文生成
自由記述理由の分類
ユーザー向け説明文生成
```

### 4.4 保守性

機能を巨大な1ファイルにまとめない。

計画作成、空き時間計算、タスク分割、所要時間補正、進捗記録、再計画、UI表示を分離する。

推奨ファイル構成:

```text
src/features/studyPlan/
  types.ts
  planner.ts
  availability.ts
  taskIntake.ts
  taskChunking.ts
  estimation.ts
  allocation.ts
  scheduling.ts
  progress.ts
  replan.ts
  profile.ts
  questionPolicy.ts
  explanation.ts

src/components/studyPlan/
  StudyPlanChatPanel.tsx
  StudyPlanModeSwitcher.tsx
  StudyPlanDraftOverlay.tsx
  StudyPlanProgressRecorder.tsx
  StudyPlanAssumptionReview.tsx
  StudyPlanTaskCard.tsx
```

### 4.5 拡張性

将来的に以下を追加できる設計にする。

```text
Google Calendar連携
学習カテゴリ別の実行率分析
曜日別の生活サイクル
タスクごとの推定精度
通知やリマインド
スマホ向け操作
長期計画
試験日からの逆算
```

### 4.6 信頼性

AIが作成した予定を勝手に確定しない。

承認前は必ず仮予定として扱う。

ユーザーが明示的に承認した予定だけを本予定として保存する。

### 4.7 データ安全性

学習予定、生活サイクル、睡眠、食事、移動などは個人の生活情報である。

要件:

```text
必要な情報だけ保存する
生データを不必要に長期間保持しない
削除できるようにする
ユーザーが確認、修正できるようにする
推測情報とユーザー確認済み情報を区別する
```

### 4.8 アクセシビリティ

進捗バーやドラッグ操作だけに依存しない。

キーボード操作や数値入力でも進捗を変更できるようにする。

色だけで仮予定と本予定を区別しない。ラベルや枠線なども使う。

### 4.9 モバイル対応

スマホでも以下が操作しやすいようにする。

```text
進捗バー
予定の承認
予定の削除
チャット入力
週間予定モード切り替え
```

ドラッグ操作が難しい場合に備え、チャット指示やメニュー操作でも修正できるようにする。

### 4.10 パフォーマンス

週表示・日表示に仮予定を大量に入れても、スクロールやドラッグが重くならないようにする。

仮予定の再計算は必要なときだけ行う。入力ごとに全体を再生成しない。

---

## 5. 想定される問題と対策

### 5.1 質問が多すぎてユーザーが面倒に感じる

問題:

```text
AIが睡眠、食事、移動、締切、範囲、見積もり、分割単位を一気に聞くと、フォーム入力のようになってしまう。
```

対策:

```text
1ターンの質問を1から2個に制限する
重要度の高い不足情報だけ聞く
影響が小さい情報は仮置きする
最後に前提確認としてまとめる
```

### 5.2 AIが勝手に予定を決めすぎる

問題:

```text
移動時間や疲労を勝手に決めると、実際には無理な予定になる。
```

対策:

```text
不確実性が高く、30分以上影響する情報は確認する
推測値にはconfidenceを持たせる
仮予定として表示し、承認前に修正できるようにする
```

### 5.3 空き時間に詰め込みすぎる

問題:

```text
カレンダー上は空いていても、実際には疲労、食事、移動、準備が必要で実行できない。
```

対策:

```text
生活プロファイルを使う
予定前後バッファを入れる
学習可能時間に実行率を掛ける
1日の割当上限を設定する
```

### 5.4 7日目の予備日が最初から埋まる

問題:

```text
作業量が多すぎる場合、日曜が普通の作業日になってしまう。
```

対策:

```text
7日目には大きなペナルティを付ける
1から6日目に入らない場合だけ使う
7日目を使う場合はユーザーに警告する
```

### 5.5 進捗入力が面倒で続かない

問題:

```text
毎回ページ番号や問題番号を細かく入力させると続かない。
```

対策:

```text
予定カードから直接記録できるようにする
進捗バーで大まかに入力できるようにする
0、25、50、75、100％程度の粗い入力も許可する
ページ数や問題数で答えられる場合は内部で変換する
```

### 5.6 予定を削除した理由を毎回聞かれて不快

問題:

```text
削除のたびに理由を聞くと監視されている感じになる。
```

対策:

```text
30分以上の予定削除
締切に影響
繰り返し削除
のときだけ聞く
選択式で軽く答えられるようにする
```

### 5.7 過去のメモリが古くなる

問題:

```text
以前の生活サイクルや勉強傾向が、現在と合わなくなる。
```

対策:

```text
confidenceを持つ
lastConfirmedAtを保持する
古い情報は信頼度を下げる
最終確認時に前提を提示する
```

### 5.8 AI入力欄が複雑化する

問題:

```text
通常相談と週間計画が混ざると、ユーザーが何をしているのか分からなくなる。
```

対策:

```text
モード切り替えを明示する
週間計画モード中は状態を表示する
いつでも通常相談に戻れるようにする
計画作成中の会話履歴を通常相談と分ける
```

### 5.9 仮予定と本予定が混ざる

問題:

```text
承認前のAI提案が正式予定のように見えると混乱する。
```

対策:

```text
isDraftを必ず持たせる
仮予定ラベルを表示する
承認前は保存対象を分ける
破棄できるようにする
```

### 5.10 チャット指示とドラッグ修正が競合する

問題:

```text
ユーザーがUIで予定を動かした後に、AIが再計画で上書きしてしまう。
```

対策:

```text
ユーザーが手動編集した予定には userEdited フラグを付ける
再計画時は userEdited の予定を極力動かさない
動かす必要がある場合は確認する
```

---

## 6. ここからはユーザーに聞くこと

以下は、Codexが勝手に決めず、実装前または実装中にユーザーへ確認すること。

### 6.1 UIモード名

確認内容:

```text
AI入力欄の切り替え名をどうするか
```

候補:

```text
相談 / 週間計画
通常 / 週間予定
AI相談 / 週間プラン
```

### 6.2 週間計画モードの開始方法

確認内容:

```text
ユーザーはどの操作で週間予定作成を始めるか
```

候補:

```text
AI入力欄のモード切り替え
「週間予定を立てる」ボタン
チャットで「来週の予定を立てて」と入力
```

### 6.3 仮予定の見た目

確認内容:

```text
AI提案の仮予定をどう見せるか
```

候補:

```text
薄い色
点線枠
AI提案ラベル
仮予定バッジ
承認前アイコン
```

色指定は既存デザインとの整合を見て決める。

### 6.4 進捗バーの粒度

確認内容:

```text
進捗バーを何％刻みにするか
```

候補:

```text
5％刻み
10％刻み
0、25、50、75、100％のスナップ
自由入力も許可
```

初期案は10％刻み + 数値入力可能。

### 6.5 予定ブロックの休憩表示

確認内容:

```text
休憩をカレンダー上に独立したブロックとして表示するか
```

候補:

```text
休憩もブロック表示
学習ブロック内に内包
最初は表示せず内部計算だけ
```

### 6.6 承認方法

確認内容:

```text
仮予定をどう承認するか
```

候補:

```text
一括承認
日ごとに承認
個別ブロックごとに承認
一括承認 + 個別修正
```

初期案は、一括承認 + 個別修正。

### 6.7 既存予定との連携範囲

確認内容:

```text
既存予定はどこから取得するか
```

候補:

```text
アプリ内予定のみ
Google Calendar連携
手入力予定
最初はアプリ内予定のみ
```

### 6.8 メモリ保存の範囲

確認内容:

```text
生活サイクルや移動時間をどこまで保存するか
```

候補:

```text
睡眠・食事のみ
予定種別ごとのバッファまで
場所ごとの移動時間まで
学習カテゴリ別の実行率まで
```

初期案は、睡眠・食事・予定種別バッファ・学習カテゴリ別補正を保存。

### 6.9 再計画のタイミング

確認内容:

```text
予定変更があったときに自動で再計画するか、ユーザー操作で再計画するか
```

候補:

```text
自動で仮再計画
通知だけ出す
ユーザーが再計画ボタンを押す
```

初期案は、通知 + ユーザー操作で再計画。

### 6.10 チャット履歴の保持

確認内容:

```text
週間予定作成中の会話履歴をどこまで保持するか
```

候補:

```text
その週だけ保持
要約だけ保持
すべて保持
保持しない
```

初期案は、その週のPlanningStateと短い要約だけ保持。

---

---

## 7. LangGraph設計方針

この機能は、単発のプロンプト処理ではなく、複数ターンの対話、状態保持、条件分岐、仮予定生成、承認、進捗記録、再計画を含む。

そのため、実装ではLangGraph、またはLangGraph相当の状態遷移管理を使う方針とする。

LangGraphを使わない場合でも、以下のノード、状態、条件分岐と同等の構造を通常のTypeScriptコードで実装すること。

### 7.1 LangGraphを使う目的

LangGraphを使う目的は、AIの返答生成そのものではなく、週間計画作成の状態遷移を安定させることである。

目的:

```text
対話の途中状態を保持する
不足情報の質問を制御する
質問しすぎを防ぐ
仮予定作成までの処理を段階化する
ユーザーの修正や承認を分岐として扱う
進捗記録後の再計画を条件分岐で扱う
LLMを呼ぶ部分と通常コードで処理する部分を分離する
```

### 7.2 基本ノード

推奨するノード構成は次の通り。

```text
START
  -> initializePlanningSession
  -> fetchExistingEvents
  -> collectUserInput
  -> extractTaskCandidates
  -> detectMissingInfo
  -> decideQuestionOrProceed
  -> askHighImpactQuestion
  -> updatePlanningStateFromAnswer
  -> buildOrUpdateUserStudyProfile
  -> chunkTasks
  -> estimateDurations
  -> calculateAvailability
  -> allocateBySixDayBaseline
  -> scheduleDraftBlocks
  -> generateAssumptionSummary
  -> presentDraftPlan
  -> awaitUserAction
  -> applyUserEdits
  -> confirmOrRevisePlan
  -> persistConfirmedPlan
  -> collectProgressRecord
  -> updateEstimatesFromProgress
  -> detectReplanTriggers
  -> replanIfNeeded
END
```

実際にはすべてを最初から実装しなくてよい。Phaseごとに段階的に追加する。

### 7.3 推奨State

LangGraphのStateには、会話履歴そのものを大量に入れない。現在の計画作成に必要な構造化データを中心に保持する。

```ts
export type WeeklyPlanningGraphState = {
  weekStartDate: string;

  uiMode: "chat" | "weekly_planning";

  planningMode:
    | "idle"
    | "collecting_tasks"
    | "asking_questions"
    | "ready_to_plan"
    | "draft_created"
    | "awaiting_approval"
    | "confirmed"
    | "recording_progress"
    | "needs_replan";

  existingEvents: CalendarEvent[];

  userProfile: UserStudyProfile;
  assumptions: PlanningAssumption[];

  rawUserMessages: {
    id: string;
    role: "user" | "assistant";
    content: string;
    createdAt: string;
  }[];

  conversationSummary?: string;

  tasks: StudyTask[];
  missingInfoQuestions: MissingInfoQuestion[];

  availableWindows: Record<string, AvailableWindow[]>;
  dailyAssignedMinutes: Record<string, number>;

  draftBlocks: StudyBlock[];
  confirmedBlocks: StudyBlock[];

  userEdits: StudyPlanUserEdit[];
  progressRecords: StudyBlockProgressRecord[];

  replanTriggers: ReplanTrigger[];

  lastAssistantMessage?: string;
};
```

会話本文をすべて長期的に保持し続けるのではなく、一定以上長くなったら要約して conversationSummary に寄せる。

### 7.4 条件分岐

LangGraphでは、次の条件分岐を明示する。

#### 不足情報がある場合

```text
detectMissingInfo
  -> decideQuestionOrProceed
      -> askHighImpactQuestion
```

ただし、質問しすぎ防止ルールを必ず通す。

```ts
if (highImpactQuestions.length > 0 && askedCountThisTurn < 3) {
  return "askHighImpactQuestion";
}
return "proceedWithAssumptions";
```

#### 所要時間が不明な場合

```text
estimateDurations
  -> createPilotPlan
```

所要時間が不明なタスクは、いきなり1週間全体へ割り振らず、初日に試行予定を作る。

#### 仮予定作成後

```text
presentDraftPlan
  -> awaitUserAction
```

ユーザー操作によって分岐する。

```text
承認 -> persistConfirmedPlan
修正 -> applyUserEdits -> scheduleDraftBlocks
破棄 -> clearDraftPlan
質問 -> answerClarification
```

#### 進捗記録後

```text
collectProgressRecord
  -> updateEstimatesFromProgress
  -> detectReplanTriggers
```

再計画が必要な場合だけ replanIfNeeded へ進む。

### 7.5 LLMノードと通常コードノードの分離

LangGraph内のノードは、LLMを呼ぶノードと、通常コードで完結するノードに分ける。

LLMを使うノード:

```text
extractTaskCandidates
askHighImpactQuestion
generateAssumptionSummary
generatePlanExplanation
classifyFreeTextReason
```

通常コードで処理するノード:

```text
fetchExistingEvents
detectMissingInfo
buildOrUpdateUserStudyProfile
chunkTasks
estimateDurations
calculateAvailability
allocateBySixDayBaseline
scheduleDraftBlocks
applyUserEdits
persistConfirmedPlan
updateEstimatesFromProgress
detectReplanTriggers
```

LLM呼び出しは最小限にする。空き時間計算、6等分、再配分、進捗計算、再計画判定をLLMに任せない。

### 7.6 チャットUIとの接続

週間予定作成モードでは、チャット入力がGraphへのイベントになる。

例:

```ts
type WeeklyPlanningEvent =
  | { type: "USER_MESSAGE"; text: string }
  | { type: "USER_SELECTED_OPTION"; questionId: string; optionId: string }
  | { type: "USER_EDITED_DRAFT_BLOCK"; edit: StudyPlanUserEdit }
  | { type: "USER_APPROVED_DRAFT_PLAN" }
  | { type: "USER_REJECTED_DRAFT_PLAN" }
  | { type: "USER_RECORDED_PROGRESS"; record: StudyBlockProgressRecord };
```

イベントを受け取ったら、現在のplanningModeに応じてGraphの次ノードへ進める。

### 7.7 仮予定とGraph State

仮予定はGraph State上では draftBlocks に保持する。

承認前は confirmedBlocks へ入れない。

ユーザーが週表示・日表示で仮予定をドラッグ修正した場合は、StudyPlanUserEdit としてGraph Stateへ追加し、再配置時に userEdited のブロックを極力動かさない。

```ts
export type StudyPlanUserEdit = {
  id: string;
  blockId: string;
  type: "move" | "resize" | "delete" | "change_task" | "manual_note";
  createdAt: string;
  payload: unknown;
};
```

### 7.8 永続化

途中のPlanningStateは、ページを閉じても復元できるようにする。

最低限保存するもの:

```text
weekStartDate
planningMode
tasks
assumptions
draftBlocks
confirmedBlocks
conversationSummary
userEdits
progressRecords
```

会話全文をすべて保存する必要はない。ユーザー体験上必要な範囲と要約を保存する。

### 7.9 エラー時の扱い

Graphの途中でエラーが起きても、計画作成セッション全体を壊さない。

対策:

```text
ノードごとに失敗状態を返す
LLM抽出に失敗したらユーザー入力をそのままタスク名として仮置きする
空き時間計算に失敗したら既存予定だけ避けて仮予定を作る
仮予定表示に失敗したらテキスト案を出す
保存に失敗したら承認前状態を維持する
```

### 7.10 Phase別のLangGraph実装

最初から完全なGraphを作らない。次の順番で実装する。

```text
Phase 1:
USER_MESSAGE -> extractTaskCandidates -> detectMissingInfo -> askHighImpactQuestion

Phase 2:
ready_to_plan -> calculateAvailability -> allocateBySixDayBaseline -> scheduleDraftBlocks -> presentDraftPlan

Phase 3:
awaitUserAction -> applyUserEdits / confirmPlan / clearDraftPlan

Phase 4:
collectProgressRecord -> updateEstimatesFromProgress -> detectReplanTriggers

Phase 5:
replanIfNeeded -> scheduleDraftBlocks -> presentDraftPlan
```

### 7.11 LangGraphについてユーザーに確認すること

ここからはユーザーに聞く。

```text
LangGraphを本当に導入するか、まずは自前の状態遷移で実装するか
フロントエンド側だけで状態管理するか、バックエンド側にGraph実行を置くか
途中状態をlocalStorageに保存するか、DBに保存するか
通常相談モードと週間計画モードで会話履歴を完全に分けるか
Graphの途中状態をユーザーに見せるか、内部状態に留めるか
```


## 8. 型定義案

### 7.1 PlanningState

```ts
export type PlanningState = {
  weekStartDate: string;

  mode: "idle" | "collecting_tasks" | "asking_questions" | "draft_created" | "awaiting_approval" | "confirmed" | "needs_replan";

  existingEvents: CalendarEvent[];
  profile: UserStudyProfile;
  assumptions: PlanningAssumption[];

  tasks: StudyTask[];
  availableWindows: Record<string, AvailableWindow[]>;
  dailyAssignedMinutes: Record<string, number>;

  draftBlocks: StudyBlock[];
  confirmedBlocks: StudyBlock[];

  progressRecords: StudyBlockProgressRecord[];
  missingInfoQuestions: MissingInfoQuestion[];

  conversationSummary?: string;
};
```

### 7.2 StudyBlock

```ts
export type StudyBlock = {
  id: string;
  taskId: string;
  chunkId?: string;

  title: string;
  start: string;
  end: string;

  plannedMinutes: number;
  plannedProgressStart: number;
  plannedProgressEnd: number;

  status: "draft" | "confirmed" | "completed" | "missed" | "deleted";
  isAiGenerated: boolean;
  isDraft: boolean;
  userEdited?: boolean;

  reason?: string;
};
```

### 7.3 StudyBlockProgressRecord

```ts
export type StudyBlockProgressRecord = {
  id: string;
  studyBlockId: string;
  taskId: string;

  plannedMinutes: number;
  actualMinutes: number;

  plannedProgressStart: number;
  plannedProgressEnd: number;
  actualProgressStart: number;
  actualProgressEnd: number;

  completed: boolean;
  difficulty?: "lighter_than_expected" | "as_expected" | "heavier_than_expected";
  note?: string;

  recordedAt: string;
};
```

### 7.4 PlanningAssumption

```ts
export type PlanningAssumption = {
  id: string;
  label: string;
  value: string;
  confidence: number;
  source: "user_confirmed" | "memory" | "default" | "ai_inferred";
  needsConfirmation: boolean;
};
```

---

## 9. 実装手順

### Phase 1: UIモード切り替え

実装すること:

```text
AI入力欄に通常相談と週間予定作成の切り替えを追加
週間予定作成モード用の会話状態を保持
通常相談と週間予定作成の履歴を分ける
```

### Phase 2: 仮予定表示

実装すること:

```text
StudyBlockにisDraftを追加
週表示・日表示に仮予定を表示
AI提案ラベルを表示
承認、破棄、個別削除を実装
```

### Phase 3: 6等分と空き時間配置

実装すること:

```text
総作業量を6等分
既存予定と睡眠時間を除外
日ごとの学習可能時間を計算
入らない日の分を再配分
7日目を予備日にする
```

### Phase 4: タスク対話

実装すること:

```text
ユーザー入力からタスク候補を作る
不足情報を検出
質問しすぎ防止ルールを適用
選択肢つきで質問する
```

### Phase 5: 進捗記録

実装すること:

```text
予定カードから実績記録を開く
実績時間を入力
進捗バーを表示
体感の重さを入力
任意メモを入力
残り時間を再計算
```

### Phase 6: 再計画

実装すること:

```text
予定変更や進捗遅れを検出
再計画候補を作る
ユーザーに確認して仮再計画
承認後に反映
```

---

## 10. 受け入れ条件

最低限、以下を満たすこと。

```text
AI入力欄で通常相談と週間予定作成を切り替えられる
週間予定作成モードで会話形式のやり取りができる
タスクを入力すると不足情報を少しずつ聞ける
質問が一度に多すぎない
6等分ベースで学習量を配分できる
7日目を予備日として扱える
既存予定と睡眠時間を避けて仮予定を作れる
仮予定を週表示・日表示に表示できる
仮予定と本予定が見分けられる
仮予定を承認できる
予定カードから実績時間と進捗を記録できる
進捗から残り時間を再推定できる
想定される問題への対策が実装方針に反映されている
未決事項はユーザー確認事項として残っている
```

---

## 11. 最終方針

この機能は、AIが勝手に完璧な予定を作る機能ではない。

目指すのは、ユーザーと対話しながら、生活に合う週間学習計画を一緒に作るメンター型機能である。

したがって、実装では次を守る。

```text
聞きすぎない
決めつけない
仮置きする
可視化する
承認を取る
実績と進捗で改善する
```
