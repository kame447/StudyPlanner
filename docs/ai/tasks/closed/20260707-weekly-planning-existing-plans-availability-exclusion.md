# 【最優先・品質】既存予定・時間割を新 intake path の busy interval として除外する(火曜バイト消失+overlap)

> **完了記録(2026-07-07・コミット `479f5e8`)**: pipeline input に既存予定・時間割を受け取る経路を追加、generator でそれらを busy interval 化して hard 除外、UI(NaturalLanguageAssistant)配線を最小実装。pipeline / generator テストで「既存予定・時間割の帯に study block が乗らない」ことを固定。weeklyPlanning 344 passed / build 成功。overlap のうち既存予定由来分は本修正で解消。study block 同士/描画のみの overlap が残る場合は実スモークで再確認し別途分離(未報告なら未観測)。

実ブラウザスモークで、火曜20:00〜22:00 のバイト予定を入力したのに、生成後の火曜にその予定が見えず、21:00〜22:00 に学習が配置された。さらに画面上にブロックの重なりも見える。既存予定・時間割が生成の availability から除外されていないのが核心。

本mdの範囲外へ進まない。git add / commit / push はしない。

## 確定している事実

コード確認済み:

- `NaturalLanguageAssistant.handleCreateWeeklyDrafts` が組む pipeline input は `previousState / userText / planningStartDate / planningDayCount / sessionPolicy (/ interpreter)` のみ。**既存カレンダー予定(`Plan[]`)も時間割(scheduleTemplates)も渡していない。**
- `weeklyDraftCandidateGenerator` は intake 由来の `constraints` / `fixedEvents`(`LifeConstraint`)だけを busy interval 化する。既存予定・時間割は入力に存在しない。
- legacy availability-aware path(`weeklyPlanningTransforms.ts` の `createTimetableBlockingPlans`、`buildPlanBusyIntervalsForDate`、`availabilitySlots.buildAvailabilitySlots`)は、既存予定・時間割・buffer を availability から hard に除外していた。**この不変条件が新 intake path に移植されていない。**

つまり直接原因は「既存予定・時間割が新 intake path の generator に入力されていない」。ユーザーがバイトを会話で伝えても、それが `fixed_event` constraint として intake に入らない限り避けられず、かつ**アプリが既に保持している火曜バイトは会話に依らず avoid されるべき**なのに除外されていない。

## 実装範囲

- pipeline 入力に既存予定・時間割(hard constraint)を渡す経路を追加する。`WeeklyPlanningIntakePipelineInput` に既存予定/時間割(または事前に算出した busy interval)を受け取るフィールドを足し、generator の busy interval に合流させる。buffer の扱いは legacy 相当(存在すれば踏襲)。
- UI 配線(`NaturalLanguageAssistant` が保持する既存予定・時間割を pipeline へ渡す)を最小で行う。UI が該当データを容易に渡せない場合は、pipeline/generator が受け取る interface までを実装し UI 配線は停止して報告。
- **block overlap の切り分けを Phase 1 で行う**: 実データ上の study block 同士の overlap / 既存予定(hard constraint)との overlap / CSS・描画上だけの overlap を区別する。既存予定との overlap が原因なら本タスクで解消(共通原因)。study block 同士の overlap や描画のみの overlap が別原因なら、その分だけ分離して報告(新規 task 候補として)。

## 回帰テスト

- 火曜20:00〜22:00 の既存予定(hard)を入力に含むと、その帯に study block が配置されないこと(全計画日で既存予定が避けられること)。
- 時間割(active templates)が busy interval として避けられること(legacy `placementScoring` の timetable テストと同等の不変条件が新 path でも成立)。
- 既存予定なしのケースが従来どおり(回帰なし)。
- overlap: Phase 1 の切り分け結果に応じ、既存予定 overlap 解消を固定するテストを追加。

## 完了条件

- 既存予定・時間割が新 intake path の生成で hard に除外され、その帯に学習が乗らないことがテストで固定される。
- overlap の原因が実データ/描画で切り分けられ、既存予定原因分は解消、別原因分は分離報告されている。
- 既存テスト全 green、build 成功。

## 触らない範囲

- 会話での固定予定聞き取り(既知予定を質問文に再利用するのは `staged-dialogue-known-info` 側)。本タスクは「アプリが既に持つ予定を generator が避ける」データ経路。
- placement scoring の重み、休憩、予備日(別タスク)。
- legacy availability-aware path 本体の改造(参照・移植の設計はしてよいが legacy の挙動は変えない)。
- AI interpreter、renderer。

## 停止条件

- UI が既存予定・時間割を pipeline へ渡す配線がデータ層の大改修に及ぶとき(interface まで実装し報告)。
- overlap が複数レイヤーの複合原因で1タスクに収まらないとき(切り分けを報告し分離)。
- 変更が pipeline/generator/該当 UI 配線と対応テストの外へ波及するとき。
- 説明できない新規テスト失敗が出たとき。

## 検証(Node 22)

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/scheduling/weeklyDraftCandidateGenerator.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```
