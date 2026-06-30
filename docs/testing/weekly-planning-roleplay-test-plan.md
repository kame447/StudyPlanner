# StudyPlanner 会話ベース・ロールプレイ型テスト設計メモ

## 目的

このメモは、実際にユーザーとAIが計画を立てる会話をもとに、StudyPlanner の週間計画入力が再現すべき挙動をテストケース化するための設計メモである。

今回の対象は、単純な `英語を3時間、数学を4時間` のような固定形式入力ではない。ユーザーが曖昧な目的、進捗、生活制約、後出し修正を自然に入力し、アプリがそれを段階的に構造化して、未承認の週間計画draftへ落とせるかを確認する。

## 基本方針

このテスト群では、自然文をすぐに予定化するのではなく、次の流れを再現できるかを見る。

```text
自然文入力
→ 期間・目的・試験種別の検出
→ 作業単位の構造化
→ 進捗の確認
→ 単位時間の確認
→ 優先方針の確認
→ 生活制約の確認
→ 仮draft生成
→ 後出し修正の反映
→ 承認待ち
```

重要なのは、情報が足りない状態で勝手に確定draftを作らないことである。足りない情報は missing info として保持し、必要な質問を返す。

## テスト対象シナリオ

### WP-RP-001 院試週末計画ロールプレイ

#### ユーザー入力の流れ

```text
今日の19時から土日の終わりまで予定立てたい
```

期待:

```text
intent: study_planning
state: needs_scope
range:
  start: today 19:00
  end: Sunday 23:59 or Sunday 24:00
missing:
  - tasks_or_goals
  - fixed_events
  - sleep_cycle
  - meal_bath_constraints
should_create_draft: false
```

この時点では、期間だけが分かっている。学習内容が不明なのでdraftは作らない。

---

```text
とりあえず、院試進めたいよね
5分野あって
第 1 部　数学・数理系
第 2 部　ソフトウェア系
第 3 部　ハードウェア系
第 4 部　OS とネットワーク
第 5 部　ヒューマンサイエンス系
なんだけど、七年分あって今は分野ごとに進めてて、数理系の2021まで終わってる
```

期待:

```text
intent: exam_prep
state: needs_progress_clarification
scope:
  exam_type: 院試
  fields:
    - 数学・数理系
    - ソフトウェア系
    - ハードウェア系
    - OS とネットワーク
    - ヒューマンサイエンス系
  total_years: 7
  strategy_hint: field_first
progress_hint:
  field: 数学・数理系
  text: 2021まで終わっている
missing:
  - year_range
  - completion_direction
  - unit_duration_estimate
should_create_draft: false
```

注意:

```text
「7年分」だけで 2019〜2025 と断定しない。
履歴や外部知識がないアプリでは、年度範囲を質問する必要がある。
```

質問例:

```text
7年分は何年〜何年ですか？
「数理系の2021まで」は、2025, 2024, 2023, 2022, 2021 が終わったという意味ですか？
それとも 2019, 2020, 2021 が終わったという意味ですか？
1つの年度×分野にだいたい何分かかりますか？
```

---

```text
7年分は2019〜2025
25〜21が終わったよ
一分野の一年分は2時間くらい
知らない分野だと細かく見るから時間かかるかも
今日は2時ぐらいには寝る予定で組んで
明日以降は10時から24時ぐらいで、お昼と夜はあんま読めない
```

期待:

```text
state: needs_priority_policy
known:
  year_range: 2019-2025
  completed:
    数学・数理系:
      - 2025
      - 2024
      - 2023
      - 2022
      - 2021
  remaining:
    数学・数理系:
      - 2020
      - 2019
    ソフトウェア系:
      - 2025
      - 2024
      - 2023
      - 2022
      - 2021
      - 2020
      - 2019
    ハードウェア系:
      - 2025
      - 2024
      - 2023
      - 2022
      - 2021
      - 2020
      - 2019
    OS とネットワーク:
      - 2025
      - 2024
      - 2023
      - 2022
      - 2021
      - 2020
      - 2019
    ヒューマンサイエンス系:
      - 2025
      - 2024
      - 2023
      - 2022
      - 2021
      - 2020
      - 2019
  unit_duration_estimate: 120
  uncertainty:
    unknown_fields_may_take_longer: true
  constraints:
    today_bedtime: 26:00
    saturday_available: 10:00-24:00
    sunday_available: 10:00-24:00
    lunch_dinner: unpredictable
missing:
  - priority_policy
  - next_field_after_math
should_create_draft: false
```

アプリは、残り全量が週末に収まらない場合、全量を無理に配置しない。優先度確認へ進む。

---

```text
分野ごとに進めてるので、数学終わったらソフトウェアをやりたい
```

期待:

```text
state: draft_ready_needs_confirmation
priority_policy: field_first
field_order:
  - 数学・数理系
  - ソフトウェア系
current_weekend_target:
  - 数学・数理系 2020
  - 数学・数理系 2019
  - ソフトウェア系 2025
  - ソフトウェア系 2024
  - ソフトウェア系 2023
  - ソフトウェア系 2022
  - ソフトウェア系 2021
  - ソフトウェア系 2020
  - ソフトウェア系 2019
assumptions:
  software_order: newest_to_oldest
  overrun_pushes_later_units
should_create_draft: true
should_save_plan: false
```

ここで初めて、未承認draftを生成してよい。

仮予定例:

```text
今日:
  19:00-21:00 数学・数理系 2020
  21:20-23:20 数学・数理系 2019
  23:20-24:00 数学の見直し・詰まり整理
  24:00-26:00 風呂・寝る準備・余白

土曜:
  10:00-12:00 ソフトウェア系 2025
  12:00-14:00 昼食・休憩バッファ
  14:00-16:00 ソフトウェア系 2024
  16:30-18:30 ソフトウェア系 2023
  18:30-20:30 夕食・休憩バッファ
  20:30-22:30 ソフトウェア系 2022
  22:30-24:00 復習・遅れ吸収

日曜:
  10:00-12:00 ソフトウェア系 2021
  12:00-14:00 昼食・休憩バッファ
  14:00-16:00 ソフトウェア系 2020
  16:30-18:30 ソフトウェア系 2019
  18:30-20:30 夕食・休憩バッファ
  20:30-22:00 全体復習
  22:00-24:00 未消化分の回収・次週への持ち越し整理
```

---

```text
あ、今日のご飯は19時までに済ますよ
一応お風呂とか寝る時間も考慮してほしいな
```

期待:

```text
state: draft_revision_applied
revision_type:
  - fixed_meal_completed_before_start
  - add_bath_and_sleep_preparation
changed:
  today_dinner_buffer_removed: true
  today_night_bath_and_bedtime_buffer_added: true
known:
  today_dinner: completed_before_19:00
  bath_and_bedtime_required: true
should_mutate_approved_plan: false
should_update_unapproved_draft: true
```

アプリは、既存draftを破棄せず、制約だけを追加して再配置する。未承認draftなので直接更新してよい。承認済みplanの場合は変更案として扱う。

## 必ずテストしたい仕様

### 1. 年度範囲を勝手に推定しない

```text
入力:
七年分あって、数理系の2021まで終わってる

期待:
- 2019〜2025 と断定しない
- 年度範囲を質問する
- 2021までの意味を質問する
```

### 2. 作業単位を構造化する

```text
入力:
5分野あって7年分

期待:
unit_model: year_field_chunk
unit_count_hint: 35
ただし年度範囲が未確定なら確定unitにはしない
```

### 3. 進捗方向を確認する

```text
入力:
数理系の2021まで終わってる

期待:
missing:
  - completion_direction
```

### 4. 単位時間を聞く

```text
入力:
一分野の一年分は2時間くらい

期待:
unit_duration_estimate: 120
uncertainty:
  unknown_fields_may_take_longer: true
```

### 5. 全量が収まらない場合は優先度確認に進む

```text
残り:
30単位 × 120分 = 約60時間

週末可用時間:
今日夜 + 土日

期待:
- 全量を無理に配置しない
- priority_policy を質問する
```

### 6. 分野ごとの進め方を保持する

```text
入力:
分野ごとに進めてるので、数学終わったらソフトウェア

期待:
priority_policy: field_first
field_order:
  - 数学・数理系
  - ソフトウェア系
```

### 7. 生活制約を後から反映する

```text
入力:
今日のご飯は19時までに済ます
風呂と寝る時間も考慮

期待:
- 今日の夕食bufferを削除
- 風呂・寝る準備枠を追加
- draftの該当箇所だけ再配置
```

## Vitest化する場合の候補

### 追加先候補

```text
src/features/weeklyPlanning/__tests__/weeklyPlanningRoleplayScenarios.test.ts
```

### fixture候補

```text
src/features/weeklyPlanning/testFixtures/weeklyPlanningRoleplayCases.ts
```

### ケースID

```text
WP-RP-001: 院試週末計画
WP-RP-001-01: 期間だけ入力
WP-RP-001-02: 院試5分野7年分
WP-RP-001-03: 年度範囲・進捗・unit-rate入力
WP-RP-001-04: 分野ごとの優先方針
WP-RP-001-05: 後出し生活制約revision
```

## 実装上の注意

- このテストは現状APIで完全に表現できない可能性がある。
- その場合、無理にproduction codeを作らず `it.todo` / `describe.todo` として仕様を残す。
- ただし、既存APIで表現できる部分は赤テストとして固定する。
- 外部OCRは実行しない。OCR済みテキストfixtureだけを使う。
- wall-clockに依存しない。`SELECTED_DATE` を固定する。
- 承認前draftと承認済みplanを区別する。
- 承認前draftはrevisionで直接更新してよい。
- 承認済みplanは直接変更せず、変更案として扱う。

## Codexに実装させる場合の方針

このMDは、production code実装指示ではなく、テスト設計メモである。

Codexに渡す場合は、次の制約を付ける。

```text
このMDを読んで、会話ベースのロールプレイ型赤テストを追加してください。
production code / UI CSS / Markdown は変更しないでください。
現状APIで書けるものは実テストにしてください。
現状APIで表現しづらいものは it.todo / describe.todo にしてください。
テスト期待値は、会話状態・不足情報・draft生成可否・revision可否を中心にしてください。
```
