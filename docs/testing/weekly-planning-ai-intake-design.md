# StudyPlanner 週間計画AI併用・会話型Intake設計思想

## 目的

StudyPlanner の週間計画機能を、単なる自然文パーサではなく、ユーザーと対話しながら学習計画を構造化するプランナーへ拡張する。

対象は、次のような現実の入力である。

```text
今日の19時から土日の終わりまで予定立てたい
院試を進めたい
5分野あって7年分ある
数理系は2025〜2021まで終わった
1分野1年分は2時間くらい
分野ごとに進めたい
今日のご飯は済ませるけど、風呂と寝る時間も考慮して
```

このような入力では、最初から予定を確定生成するのではなく、期間、目的、範囲、進捗、単位時間、優先度、生活制約を段階的に確認し、未承認draftとして計画を提示する必要がある。

## 基本思想

### 1. AIは予定を直接作るのではなく、入力を構造化する

AIを使う場合でも、AIに最終スケジュールを自由生成させない。

AIの役割は次に限定する。

```text
- 曖昧な自然文の意図理解
- 学習目的・試験種別・範囲・進捗・制約の抽出
- 不足情報の判定
- 次に聞くべき質問の生成
- 後出し修正の意図分類
- OCR済みテキストや範囲表の構造化
```

実際の配置、分割、既存予定との衝突回避、保存処理は deterministic な通常コードで行う。

### 2. Schedulerは決定的ロジックとして守る

次の処理はAIに任せない。

```text
- 合計分数の保持
- 120分超セッションの分割
- 30分未満slotの破棄
- 既存予定・時間割・bufferとの衝突回避
- 睡眠・食事・風呂・移動などのhard/soft constraint処理
- 予定の配置スコアリング
- 未承認draftと承認済みplanの区別
- 保存・削除・一括承認・一括破棄
```

AIの出力は必ず検証し、検証済みの `PlanningIntakeState` または `WeeklyPlanDraft` だけを scheduler に渡す。

### 3. 自然文から即draft化しない

曖昧な入力に対して、すぐに予定を作らない。

例:

```text
来週テストだから計画立てたい
院試進めたい
数学やばい
今日の19時から土日の終わりまで予定立てたい
```

これらは intent としては検出するが、学習内容・目標・制約が不足しているため `needs_*` 状態へ進める。

### 4. 会話状態を明示的に持つ

実装は、単発の関数呼び出しではなく、会話の進行状態を扱う。

候補:

```ts
type PlanningIntakeStatus =
  | 'idle'
  | 'range_collected'
  | 'scope_collected'
  | 'needs_exam_info'
  | 'needs_year_range'
  | 'needs_progress_clarification'
  | 'needs_unit_rate'
  | 'needs_priority_policy'
  | 'needs_life_constraints'
  | 'draft_ready'
  | 'revision_pending'
  | 'approved';
```

この状態をもとに、次に聞くべき質問を決める。

### 5. 情報不足はmissingとして保持する

「分からない」入力は失敗ではない。

例:

```text
時間は分からない
どれくらいかかるか分からない
数学がやばいけど範囲はまだ見てない
```

この場合は、仮見積もりを提案するか、必要な単位時間を質問する。

```text
1ページ何分くらいで進めますか？
分からなければ、仮に1ページ5分で置いて計画しますか？
```

仮置きした場合は、plan/draftに assumption として残す。

## PlanningIntakeState案

```ts
export type PlanningIntent =
  | 'weekly_study_planning'
  | 'exam_prep_planning'
  | 'regular_schedule'
  | 'study_advice'
  | 'unknown';

export type PlanningRange = {
  startDateTime?: string;
  endDateTime?: string;
  sourceText?: string;
  confidence: 'explicit' | 'inferred' | 'missing';
};

export type StudyScopeUnit =
  | 'minutes'
  | 'hours'
  | 'pages'
  | 'problems'
  | 'words'
  | 'lessons'
  | 'chapters'
  | 'year_field_chunk'
  | 'topic'
  | 'unknown';

export type StudyTaskScope = {
  title: string;
  subject?: string;
  examType?: string;
  field?: string;
  year?: number;
  unit: StudyScopeUnit;
  amount?: number;
  rawText: string;
  requiresTimeEstimate: boolean;
};

export type StudyProgress = {
  completed?: string[];
  current?: string;
  incomplete?: string[];
  ambiguity?: 'completion_direction' | 'year_range' | 'scope_range' | 'none';
  rawText?: string;
};

export type UnitRateEstimate = {
  unit: StudyScopeUnit;
  minutesPerUnit?: number;
  source: 'user' | 'assumption' | 'default';
  uncertainty?: 'low' | 'medium' | 'high';
};

export type LifeConstraint = {
  kind: 'sleep' | 'meal' | 'bath' | 'commute' | 'club' | 'cram_school' | 'fixed_event' | 'unavailable' | 'buffer';
  start?: string;
  end?: string;
  durationMinutes?: number;
  hardness: 'hard' | 'soft';
  rawText?: string;
};

export type PriorityPolicy =
  | { kind: 'field_first'; order: string[] }
  | { kind: 'deadline_first' }
  | { kind: 'weakness_first' }
  | { kind: 'score_weight_first' }
  | { kind: 'balanced' }
  | { kind: 'unknown' };

export type PlanningIntakeState = {
  status: PlanningIntakeStatus;
  intent: PlanningIntent;
  range?: PlanningRange;
  tasks: StudyTaskScope[];
  progress: StudyProgress[];
  unitRates: UnitRateEstimate[];
  constraints: LifeConstraint[];
  priorityPolicy: PriorityPolicy;
  missing: string[];
  assumptions: string[];
  questions: string[];
  shouldCreateDraft: boolean;
  shouldSavePlan: false;
};
```

## 会話フロー

### Step 1. 期間の受け取り

入力例:

```text
今日の19時から土日の終わりまで予定立てたい
```

期待:

```text
status: range_collected
range:
  start: today 19:00
  end: Sunday 23:59
missing:
  - tasks_or_goals
  - life_constraints
shouldCreateDraft: false
```

### Step 2. 目的・範囲の受け取り

入力例:

```text
院試進めたい。5分野あって7年分ある。
```

期待:

```text
intent: exam_prep_planning
scope:
  examType: 院試
  unitModel: year_field_chunk
  fields: 5件
  totalYears: 7
missing:
  - year_range
  - progress
  - unit_duration_estimate
```

注意:

```text
7年分とだけ言われた場合、2019〜2025と断定しない。
年度範囲はユーザー入力、OCR、添付資料から取得する。
```

### Step 3. 進捗の確認

入力例:

```text
数理系の2021まで終わってる
```

期待:

```text
status: needs_progress_clarification
missing:
  - completion_direction
```

質問例:

```text
2021まで、は新しい年度から2021まで完了という意味ですか？
それとも古い年度から2021まで完了という意味ですか？
```

### Step 4. unit-rateの確認

入力例:

```text
1分野1年分は2時間くらい
```

期待:

```text
unitRate:
  unit: year_field_chunk
  minutesPerUnit: 120
  source: user
```

入力例:

```text
時間は分からない
```

期待:

```text
status: needs_unit_rate
questions:
  - 仮に1単位120分で置いて計画しますか？
assumptions:
  - unitRate is not confirmed
```

### Step 5. 優先方針の確認

入力例:

```text
分野ごとに進めたい。数学が終わったらソフトウェア。
```

期待:

```text
priorityPolicy:
  kind: field_first
  order:
    - 数学・数理系
    - ソフトウェア系
```

全量が期間に収まらない場合は、優先方針を確認してからdraftを作る。

### Step 6. 生活制約の確認

入力例:

```text
今日は2時くらいに寝る
明日以降は10時から24時
昼と夜は読めない
風呂と寝る時間も考慮して
```

期待:

```text
constraints:
  - sleep today until 26:00
  - available Saturday 10:00-24:00
  - available Sunday 10:00-24:00
  - lunch/dinner flexible buffer
  - bath/bedtime preparation
```

### Step 7. draft生成

必要情報が揃ったら、未承認draftを作る。

```text
shouldCreateDraft: true
shouldSavePlan: false
```

draft生成後も、ユーザーが承認するまでは通常予定として保存しない。

### Step 8. 後出し修正

入力例:

```text
あ、今日のご飯は19時までに済ます
```

期待:

```text
revision:
  type: fixed_meal_completed_before_start
  target: unapproved_draft
  action: remove_today_dinner_buffer
```

入力例:

```text
数学多めにして
```

期待:

```text
revision:
  type: increase_subject
  targetSubject: 数学
missing:
  - increase_amount
questions:
  - 数学をどれくらい増やしますか？
```

入力例:

```text
日曜夜は無理
```

期待:

```text
revision:
  type: unavailable_time_added
  action:
    - remove_or_relocate_blocks
    - mark_unplaced_if_needed
```

## AI adapter設計

AIを使う場合、直接 UI 文や予定配列を自由生成させない。

AI adapterは次のようなJSONを返す。

```json
{
  "intent": "exam_prep_planning",
  "status": "needs_progress_clarification",
  "range": {
    "startDateTime": "2026-06-26T19:00:00",
    "endDateTime": "2026-06-28T23:59:00",
    "confidence": "explicit"
  },
  "tasks": [
    {
      "title": "院試過去問",
      "examType": "院試",
      "unit": "year_field_chunk",
      "rawText": "5分野あって7年分"
    }
  ],
  "missing": ["year_range", "completion_direction", "unit_duration_estimate"],
  "questions": [
    "7年分は何年〜何年ですか？",
    "数理系の2021まで、はどの年度が完了済みという意味ですか？"
  ],
  "shouldCreateDraft": false,
  "shouldSavePlan": false
}
```

アプリ側では次を検証する。

```text
- JSON schemaに合っているか
- shouldSavePlan が true になっていないか
- 年度範囲や時間を根拠なく推定していないか
- missing があるのに shouldCreateDraft が true になっていないか
- duration / amount / date が現実的な範囲か
```

## AI併用時の禁止事項

```text
- AIに承認済みplanを直接変更させない
- AIに保存処理を判断させない
- AIが推定した年度範囲を確定情報として扱わない
- AIが推定した所要時間を user-confirmed として扱わない
- AIの自由文だけを根拠にdraftを確定しない
- AIが作った予定をscheduler validationなしで表示しない
```

## テスト方針

### 1. 小さい単体テスト

対象:

```text
- intent detection
- task extraction
- amount extraction
- unit-rate parsing
- priority policy parsing
- life constraint parsing
```

### 2. 会話状態テスト

対象:

```text
- range_collected
- needs_year_range
- needs_progress_clarification
- needs_unit_rate
- needs_priority_policy
- draft_ready
- revision_pending
```

### 3. ロールプレイ型テスト

対象:

```text
- 院試週末計画
- 定期テスト前
- 受験生長期計画
- OCR範囲表
- 部活・塾あり
- 後出し修正
```

### 4. property-based test

対象:

```text
- 合計分数保存
- session duration制約
- unavailable timeとの非重複
- bufferとの非重複
- 30分未満block生成禁止
```

## 実装フェーズ案

### Phase A. 型と状態モデルだけ追加

目的:

```text
- PlanningIntakeState の型を作る
- 既存実装を壊さない
- まだAI adapterは実装しない
```

作業:

```text
src/features/weeklyPlanning/intake/weeklyPlanningIntakeTypes.ts
src/features/weeklyPlanning/intake/weeklyPlanningIntakeState.ts
```

### Phase B. ルールベースintake reducer

目的:

```text
- 既存の assessWeeklyPlanningRequest / mergeWeeklyPlanningRevision を取り込みながら、
  PlanningIntakeState を更新できる薄いreducerを作る
```

作業:

```text
applyWeeklyPlanningUserTurn(previousState, userText, context)
```

### Phase C. roleplay赤テストを通す範囲を広げる

目的:

```text
- 院試週末計画の最初の数turnを通す
- 年度範囲を勝手に推定しない
- unit-rateとpriority policyを保持する
```

### Phase D. AI adapterの境界だけ作る

目的:

```text
- 実AI呼び出しはまだしない
- adapter interface と validation を作る
```

作業:

```text
WeeklyPlanningIntakeInterpreter
validateAiPlanningIntakeOutput
```

### Phase E. 実AI併用

目的:

```text
- ルールベースで難しい入力だけAIに渡す
- AI出力はschema validation後にstateへmergeする
```

## 直近の実装でやるべきこと

まずは production の大改修ではなく、次を最小単位にする。

```text
1. intake/ ディレクトリを追加
2. PlanningIntakeState 型を追加
3. applyWeeklyPlanningUserTurn の薄い骨格を追加
4. 既存の assessWeeklyPlanningRequest を内部で呼ぶ
5. roleplayテストのうち、期間入力・院試scope・年度範囲未確定・unit-rate保持までを通す
6. schedulerやUI保存導線は触らない
```

## 完了条件

最初の実装フェーズでは、次を満たせばよい。

```text
- production codeの保存導線を壊していない
- 通常予定入力をweekly planningに誤爆させていない
- 「今日19時から土日の終わりまで」をrangeとして保持できる
- 「院試5分野7年分」をscopeとして保持できる
- 「7年分」だけで2019〜2025と断定しない
- 「数理系2021まで」の曖昧さをmissingとして保持できる
- 「1分野1年分2時間」をunit-rateとして保持できる
- missingが残っている間はshouldCreateDraft=false
```

## Codexへの実装指示雛形

```text
docs/testing/weekly-planning-ai-intake-design.md を読んでください。

今回は、AI併用を見据えた週間計画intake状態モデルの第一歩を実装してください。
AIの実API呼び出しはまだ実装しないでください。

目的:
- 自然文から即draft化するのではなく、PlanningIntakeStateとして段階的に構造化する
- 期間、目的、範囲、進捗、unit-rate、優先方針、生活制約、missing情報を保持できるようにする
- 既存の通常AI入力・通常予定保存導線は壊さない
- 既存schedulerや保存処理は変更しない

やること:
1. `src/features/weeklyPlanning/intake/` を追加する
2. `weeklyPlanningIntakeTypes.ts` に PlanningIntakeState 関連の型を追加する
3. `weeklyPlanningIntakeReducer.ts` に `applyWeeklyPlanningUserTurn` の薄い実装を追加する
4. 既存の `assessWeeklyPlanningRequest` / `mergeWeeklyPlanningRevision` を使えるところでは再利用する
5. 直近のロールプレイテストのうち、期間入力、院試scope、年度範囲未確定、進捗方向確認、unit-rate保持までを通す
6. AI adapterは interface と TODO コメントまでにする。実API呼び出しはしない

禁止:
- UI CSS変更
- 保存処理変更
- scheduler本体の大改修
- 通常予定保存導線の変更
- 承認済みplanの直接変更
- 新規依存追加
- anyで逃げる
- テスト期待値の雑な変更

テスト:
- 追加/変更したweeklyPlanning関連テストだけ実行する
- 既存の赤テストは赤のままでよいが、今回の対象範囲で通せるものは通す
- npm run build と git diff --check は、明示指示がない限り実行しない

報告:
- 追加/変更したファイル
- 追加した型と状態
- どのroleplay仕様を通したか
- まだit.todoまたは赤テストとして残した範囲
- production codeの保存導線・UI CSSを変更していないこと
```
