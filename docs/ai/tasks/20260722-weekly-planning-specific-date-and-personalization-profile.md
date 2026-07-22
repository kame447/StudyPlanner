# 特定日計画と個人最適化profileを汎用スキーマへ追加する

Status: foundation implemented / automated verified / production not connected
Date: 2026-07-22
Branch: `test/weekly-planning-semantic-schema-eval`
PR: #77

## 背景

汎用semantic v5は計画期間としてabsolute date rangeを持つため、一日だけの計画期間は表現できた。一方で次の二点が不足していた。

- 繰り返しまたは複数日計画の中で、特定タスクを特定日だけ実行・除外する専用fact
- 将来の配置最適化に使う個人別係数のversion付き保存枠

また、計画全体で「その日は何も入れない」という日付だけのhard unavailable宣言は、既存resolverが時刻不足として扱っていた。

## 固定した責務

### 特定日

```text
一日だけの計画
→ planning window start=end

特定タスクをその日だけ行う／行わない
→ task date rule

その日は計画全体で何も入れない
→ whole-day hard unavailable window
```

- task date ruleは`allowed_date | excluded_date`とする。
- 日付はcanonical date expressionだけを受ける。
- 名前付き時間帯やclockを混ぜない。
- 必須条件として扱い、softな日付ルールは拒否する。
- 複数allowed dateは和集合とする。
- excluded dateは許可日から差し引く。
- 同日がallowed/excludedの両方ならpreview前に一件だけ確認する。
- 固定予定にも同じ除外日を適用する。
- 除外で固定予約が0件になっても可動作業へ戻さない。

### 非連続の日付集合と曜日集合

```text
7月8日、10日、11日だけ行う
→ allowed_date(7/8) + allowed_date(7/10) + allowed_date(7/11)
→ 許可日の和集合

毎週、水曜と金曜から日曜に行う
→ recurrence.kind=weekly
→ days=[wed, fri, sat, sun]
→ planning window内の具体日付へ展開
```

- 非連続の具体日付を最小日から最大日までの連続rangeへ変換しない。
- 一つの曜日集合を複数recurrence factへ分割せず、一つの`days`配列として保持する。
- `金曜から日曜`等の曜日rangeはAI境界で`fri, sat, sun`へ展開する。
- task-level recurrenceから得た曜日集合は、可動タスクの`taskDateEligibilities.allowedDates`へ統合する。
- exact excluded dateは曜日集合から差し引く。
- recurrence fact IDもscheduler inputのsource fact refsへ保持する。
- component-level recurrenceと`custom` recurrenceはtask全体へ勝手に昇格・解釈しない。

発見した欠落:

- recurrence fact自体と固定予定・availabilityの曜日展開は実装済みだった。
- しかし可動タスクではrecurrenceがgeneric scheduler inputへ反映されず、曜日条件が途中で失われていた。
- `weeklyPlanningTaskDateRuleResolver`へtask-level recurrenceの展開を統合し、同じtask date eligibility contractへ揃えた。

### 個人最適化

個人最適化係数はSemanticTurnDocumentやPlanningFactGraphへ入れない。アカウント単位profileへ保存する。

```text
current plan facts
→ 今回ユーザーが明示した条件

personalization profile
→ 長期的な個人差、信頼度、根拠、更新日時

global scoring model
→ 全ユーザー共通の基本weightとversion
```

単発発話から学習係数を直接保存しない。明示設定または計画と実績の集計を根拠に更新する。

## 実装

### semantic / canonical state

- `allowed_date | excluded_date`をalpha2 temporal kindへ追加した。
- strict response schemaとsystem promptを更新した。
- date rule専用validatorを追加した。
- date ruleを通常のtemporal constraintから分離し、正式`TaskDateRuleFact`へcanonicalizeするようにした。
- fact graph、diff、local ID mappingへ`task_date_rule`を追加した。
- normalizerへ非連続日を一日ずつ保持する指示を追加した。
- normalizerへ曜日rangeをcanonical weekday配列へ展開する指示を追加した。

### resolution / scheduler

- taskごとのallowed/excluded date resolverを追加した。
- conflict、orphan、unsupported custom date、invalid strengthをissue化した。
- recurring fixed reservationへdate ruleを適用するadapterを追加した。
- date-only hard unavailableを00:00〜翌日00:00へ解決するadapterを追加した。
- generic scheduler inputをv2へ更新し、task date eligibilitiesを追加した。
- scheduler inputのsource fact refsへ日付ルールを含めた。
- dialogue policyへdate rule issueの優先順位と具体的質問を追加した。
- task-level `daily / weekdays / weekends / weekly(days) / times_per_week(days)` recurrenceをplanning window内のallowed datesへ展開するようにした。
- 曜日集合と複数のallowed dateを和集合し、excluded dateを最後に差し引くようにした。

### personalization

- personalization profile schemaをv2へ更新した。
- v1 profileを空のplacement model付きv2へ読み替えるmigrationを追加した。
- feature versionとweight versionを追加した。
- 文脈別parameter、scope、根拠、信頼度、更新日時を保持する構造を追加した。
- 係数を`-4〜4`へ制限し、未知feature、不正key、上限超過をsanitizeする。
- parameter数を最大300件へ制限した。

配置featureの初期集合:

```text
completion affinity
start delay penalty
interruption penalty
reschedule penalty
time-band affinity
weekday affinity
session-length affinity
transition cost
sleep-proximity penalty
workload-density penalty
subject affinity
```

## 検証

成功確認済み:

- 一日だけのplanning horizon
- taskのallowed date
- taskのexcluded date
- 複数の非連続allowed dateの和集合
- `wed + fri + sat + sun`の曜日集合展開
- 曜日集合からexact excluded dateを差し引くこと
- 曜日集合をgeneric scheduler inputまで保持すること
- recurrence fact IDをsource fact refsへ保持すること
- 同一日のallow/exclude conflict
- custom dateを後段で再解析しないこと
- 計画範囲外の日付を別日に変換しないこと
- date-only hard unavailableを終日休みに変換
- recurring fixed reservationから例外日を除外
- strict schemaにdate rule kindを含むこと
- clock、named period、soft date ruleを拒否
- date ruleを通常temporal constraintへ混入させないこと
- canonical ID、diff、local mapping
- conflict時の単一質問
- personalization v1→v2 migration
- bounded coefficientとprovenanceの保持
- unknown featureと不正係数の除去
- semantic全test
- Worker routing test
- full TypeScript
- Vite production build

既存の検証commit:

```text
8913477  task date resolver
6514a81  specific-date scheduler integration
86d1972  personalization profile v2
 e8c8c5c  date-rule validation
89e8942  canonicalizer separation
69bebad  semantic + personalization + routing regression
3d6d674  task-date dialogue regression
a4c29be  full TypeScript + production build
090a5eb  semantic全test + personalization + routing + full TypeScript + production build
93c2de3  通常build設定復元後のfull TypeScript + production build
```

非連続日・曜日集合の追加検証commitはCloudflare Pages結果確定後に追記する。

一括検証用の一時package設定とtemporary tsconfigは検証後に削除・復元する。

## 注意点

- 新semantic pathとscheduler input v2はproduction executorへ未接続である。
- 現行schedulerはtask date eligibilitiesをまだ消費しない。
- personalization係数はproduction placement scoreへ未接続である。
- 計画実績から係数を更新するlearning pipelineは未実装である。
- feature/weight version変更時のmigration policyをproduction接続前に固定する必要がある。
- correction/delete実適用が未実装のため、既存の日付ルールを会話で削除・置換する処理は次gateである。
- `times_per_week`で曜日候補がない場合の「週N回」という回数制約は、曜日eligibilityとは別のscheduler constraintとして今後保持する必要がある。

## 次の作業

1. fact lifecycleとcorrection/delete実適用
2. old persisted state migration
3. scheduler adapterでtask date eligibilitiesを消費
4. production personalization scoringへprofileを読取専用で接続
5. plan/actual eventからparameter候補を生成する学習pipeline
6. `times_per_week`回数制約のscheduler contract追加
7. roleplay、real API eval、七視点監査
