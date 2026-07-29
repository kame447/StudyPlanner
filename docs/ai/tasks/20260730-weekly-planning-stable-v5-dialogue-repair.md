# Stable V5の認識済みタスク再質問と構造化repair失敗を修正する

Status: active
Created: 2026-07-30
Issue: #98
Branch: `agent/stable-v5-dialogue-repair-seven-audit`
Audit: `docs/ai/audits/20260730-weekly-planning-stable-v5-dialogue-repair-seven-audit.md`
Source trace: `weekly-trace-fbda7e10-9506-590c-bac3-1c56629613d2`

## 目的

Production trace schema v2で再現した、認識済みタスクに対する同一一般質問の反復と、正常な複数タスク入力がsemantic repairの失敗によって破棄される問題を、一つの論理タスクとして修正する。

## 確認済みの症状

1. AI normalizerは「午前中は研究」「午後は院試の勉強」を2件のtaskとpreferred windowへ正常に構造化し、Fact Graph revision 2へ適用している。
2. workloadが0件でscheduler compilationが`empty`になると、Stable V5 runtimeは認識済みtaskを参照せず、直前と同じ一般質問を返す。
3. 4時間・2時間・2時間の入力では、initial responseが`earliest_start`へnamed periodを付け、clockを持たないため`missing-start`となる。
4. repairはユーザーが述べていない09:00・15:00を発明し、named periodも残すため`cannot-combine-with-clock`となる。
5. runtimeは実装側のschema/repair不整合を利用者の言い換え問題として返す。

## 受け入れ条件

- taskを1件以上認識済みでworkloadがない場合、既知taskを明示し、不足している作業量を質問する。
- taskがない場合の初回一般質問は維持する。
- repair instructionは、priorityを時間制約へ変換しないこと、ユーザーが述べていないclockを発明しないこと、named periodとclockを同時に残さないことを明示する。
- trace相当のinitial rejectからrepair acceptedへ進む回帰testを追加する。
- normalization rejected時の利用者向け文言は、入力の言い換えを一方的に要求せず、構造化処理側の失敗であることを明示する。
-既存の正常preview生成、今日だけのplanning window、provider failure、canonicalization failureを壊さない。
- focused test、typecheck、typecheck:build、full test、build、diff checkの結果を記録する。

## 対象ファイル

- `src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5.ts`
- `src/features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeExecutor.ts`
- `src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5.test.ts`
- `src/features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeExecutor.test.ts`
- 必要なtrace回帰fixtureまたは専用test

## 対象外

- Stable V5全体のschema世代更新
- AI model変更
- task-specific preferred windowをpreview schedulerへ反映する設計変更
- 既存Fact Graph内の曖昧なtask自動統合
- Issue #89のtrace保存・管理画面運用

対象外で発見した問題は監査Markdownへ残し、今回の修正と混在させない。

## 完了処理

実装と検証が完了したら、本ファイルを`docs/ai/tasks/closed/20260730-weekly-planning-stable-v5-dialogue-repair.md`へ移し、Status、Closed、検証結果、残余リスクを記録する。