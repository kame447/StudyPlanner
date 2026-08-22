# 週間計画historical contract migration record

Status: closed / reference only
Recorded: 2026-07-16

## 1. 目的

closedまたはsuperseded文書に残る旧contractを、現在の実装指示として再実行しないため、後続の所有先を一件へ記録する。

## 2. AI single-interpreter contract

`20260711-weekly-planning-ai-interpretation-stage1-single-interpreter.md`は、通常provider経路でAIを唯一のsemantic interpreterとする時点の履歴である。

PR #3以後の`main`は、legacy fallbackを含まないdeterministic baselineを先に適用し、AI commandを補完する。最終contractはroadmap Decision gate 4.1で未決定である。

したがって、旧single-interpreter文書を根拠に現在のbaseline処理を削除しない。逆に、現在のbaseline方式を確定contractとみなして旧文書を削除もしない。

## 3. Preview-firstからauthorization gateへの移行

`20260711-weekly-planning-preview-policy-stage2-preview-first-decision.md`は、assumable slotだけが残る場合にpreviewを先に生成する旧方針を記録する。

現在のv4 contractは、readinessと`DraftGenerationIntent=user_authorized`が揃うまでpreviewを生成しない。pending assumptionを使用したpreviewの表示可否と保存可否は別に扱い、保存境界で再検証する。

現在の所有先:

- `20260714-weekly-planning-behavior-aware-vertical-slice-completion.md`
- `20260714-weekly-planning-dialogue-stack-implementation.md`
- `weekly-planning-dialogue-architecture-v4.md`

## 4. Superseded goal acceptance

`superseded/20260710-weekly-planning-dialogue-stage3-goal-acceptance.md`は独立stageとして再開しない。`set_study_goal`、candidate validation、adapter/reducer、legacy fallback保護は現在のintake pipelineとbehavior-aware completionへ帰属する。

未完了のgoal dialogue品質は、旧Stage3ではなくcurrent roleplay、entrypoint verification、legacy fallback retirement候補で扱う。

## 5. Superseded multi-slot regression

`superseded/20260710-weekly-planning-multi-slot-turn-regression.md`の複合発話観点は、現在のcandidate/command独立評価、correction envelope、DA3c conversation evaluation、roleplay strict assertionsへ移管する。

旧scenarioの存在だけでcoverage completeとしない。現在のcoverage statusは`docs/testing/weekly-planning-roleplay-status.md`を正とする。

## 6. 運用規則

- historical/closed/superseded文書をcurrent taskとして直接実行しない。
- 現行contractと競合する記述は削除せず、当時の履歴として保持する。
- product decision未確定の論点は`weekly-planning-current-contract-status.md`とroadmap Decision gatesを参照する。
- 同じ移行説明を各履歴文書へ重複追記しない。
