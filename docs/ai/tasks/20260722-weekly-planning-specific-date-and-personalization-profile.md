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

### resolution / scheduler

- taskごとのallowed/excluded date resolverを追加した。
- conflict、orphan、unsupported custom date、invalid strengthをissue化した。
- recurring fixed reservationへdate ruleを適用するadapterを追加した。
- date-only hard unavailableを00:00〜翌日00:00へ解決するadapterを追加した。
- generic scheduler inputをv2へ更新し、task date eligibilitiesを追加した。
- scheduler inputのsource fact refsへ日付ルールを含めた。
- dialogue policyへdate rule issueの優先順位と具体的質問を追加した。

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

検証commit:

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

一括検証用の一時package設定とtemporary tsconfigは削除・復元済みである。

## 注意点

- 新semantic pathとscheduler input v2はproduction executorへ未接続である。
- 現行schedulerはtask date eligibilitiesをまだ消費しない。
- personalization係数はproduction placement scoreへ未接続である。
- 計画実績から係数を更新するlearning pipelineは未実装である。
- feature/weight version変更時のmigration policyをproduction接続前に固定する必要がある。
- correction/delete実適用が未実装のため、既存の日付ルールを会話で削除・置換する処理は次gateである。

## 次の作業

1. fact lifecycleとcorrection/delete実適用
2. old persisted state migration
3. scheduler adapterでtask date eligibilitiesを消費
4. production personalization scoringへprofileを読取専用で接続
5. plan/actual eventからparameter候補を生成する学習pipeline
6. roleplay、real API eval、七視点監査
