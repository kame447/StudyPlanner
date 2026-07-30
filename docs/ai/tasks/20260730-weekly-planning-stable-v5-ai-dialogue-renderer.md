# Stable V5の利用者向け返答をAI rendererへ接続する

Status: active
Priority: P1
Requirement IDs: ISSUE-101

## 1. 背景

Stable V5では、利用者発話の意味構造化にはAIを使用しているが、利用者へ返す質問・案内文は`weeklyPlanningStableV5RuntimeExecutor.ts`のswitchとbranch別固定文字列で生成している。Production traceでも正常turnの`responseSource`はすべて`rules`であり、文脈に対して機械的な応答になっている。

旧legacy経路には`weeklyPlanningAiDialogueRenderer.ts`が残っており、アプリが決めた質問targetをAIが自然な日本語へ書き換え、出力を検証して失敗時にdeterministic fallbackへ戻す境界がある。ただし旧inputは院試中心の`PlanningIntakeState`とslot registryに結合しており、Stable V5へそのまま戻せない。

## 2. 目的

Stable V5のsemantic normalizer、Fact Graph、readiness、dialogue action選択、scheduler、preview、approval、saveを変更せず、deterministic coreが決定済みの利用者向けactionだけをAI rendererで自然な日本語へ文章化する。

AI rendererが失敗、不正出力、意味逸脱、時刻捏造、危険内容を返した場合は、現在のdeterministic文面をそのまま使用し、計画状態を変更しない。

## 3. 計画書との対応

- product spec: `docs/weekly-planning/weekly-planning-spec.md`
- architecture: `docs/architecture/weekly-planning-dialogue-architecture-v5.md`
- current contract: `docs/ai/weekly-planning-current-contract-v5.md`
- roadmap: `docs/ai/strategy/weekly-planning-roadmap.md`
- audit: `docs/ai/audits/20260730-weekly-planning-stable-v5-ai-dialogue-renderer-seven-audit.md`
- issue: #101

## 4. Entry conditions

- mainはPR #99マージ後の`475994440b86f7a2992f3e640b192b7f9cd21f36`。
- 同一目的のopen Issue、branch、PRは存在しない。
- branchは`agent/stable-v5-ai-dialogue-renderer`を使用する。
- 進行停止バグとtask-specific preferred windowは別作業とする。

## 5. 対象ファイル

- 新規:
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningStableV5AiDialogueRenderer.ts`
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningStableV5AiDialogueRenderer.test.ts`
- 変更:
  - `src/features/weeklyPlanning/weeklyPlanningTurnExecutor.ts`
  - `src/features/weeklyPlanning/application/weeklyPlanningStableV5InstrumentedRuntimeExecutor.ts`
  - `src/features/weeklyPlanning/application/weeklyPlanningTurnSideEffects.ts`
  - `src/features/weeklyPlanning/trace/weeklyPlanningStableV5TraceRuntime.ts`
  - `src/features/weeklyPlanning/trace/weeklyPlanningTurnDiagnosticV2.ts`
  - 関連testとcanonical docs

ここに無いscheduler、semantic schema、Fact Graph canonicalizer、preview、approval、saveへ変更が必要になった場合はscopeを広げず報告する。

## 6. 現在の処理経路

```text
NaturalLanguageAssistant
→ executeWeeklyPlanningTurn
→ executeWeeklyPlanningStableV5RuntimeTurn
→ AI semantic normalizer
→ validator / canonicalizer / Fact Graph
→ generic scheduler input
→ decideWeeklyPlanningStableDialogueV5
→ renderQuestion switchまたはbranch別固定文
→ assistant message
```

旧legacy経路:

```text
deterministic dialogue decision
→ createDialogueRenderInput
→ createAiWeeklyPlanningDialogueRenderer
→ structured questions
→ sanitizeDialogueRenderOutput
→ AI採用またはdeterministic fallback
```

## 7. 確認済みの事実

- Stable V5は旧AI dialogue rendererを通らない。
- `WeeklyPlanningStableDialoguePolicyV5`は質問code、fact ID、detailsをdeterministicに選択する。
- 旧rendererは質問target、件数、順序をAIへ決めさせず、outputを検証している。
- trace typeは`ai`、`deterministic_fallback`、`rules`、`system`を表現できる。
- 現行Stable V5 turn diagnosticは正常応答を推定で`rules`としている。

## 8. 未確認事項

- 実OpenAI接続での文面品質と追加latency。
- Production browserでのroleplay結果。
- GitHub Actions以外のローカルtypecheck、test、build。本作業環境ではローカルcheckoutを使用していない。

## 9. 問題点

Stable V5 architectureには`unified renderer`が位置づけられているが、runtimeではrenderer境界が接続されず固定文生成へ退行している。意味判断をAIへ渡したことと、利用者向け文章をAIへ渡すことが混同されており、前者だけが実装されている。

## 10. 修正方針

1. Stable V5専用の汎用AI dialogue rendererを新設する。
2. renderer inputは、deterministic action ID、action kind、question code、fallback text、preview件数だけに限定する。
3. raw user text、private Fact Graph、scheduler再計算可能な情報は渡さない。
4. renderer outputは`actionId`と`text`のstrict JSONとする。
5. action ID一致、長さ、禁止内容、質問性、引用task保持、時刻・日付捏造、preview件数を検証する。
6. semantic failureとduplicate suppressionはrendererへ渡さずsystem文を維持する。
7. renderer failure時はfallback textを使い、`responseSource=deterministic_fallback`とする。
8. AI採用時は`responseSource=ai`とし、表示した質問文だけを`state.questions`へ同期する。`lastQuestionContext`はdeterministic codeを維持する。
9. traceへrenderer request、response、decision、最終response sourceを記録する。

## 11. 触らない範囲

- semantic schema、normalizerの意味抽出責務
- Fact Graph canonicalization
- quantity roleの解決規則
- 複数workloadへの短答結合
- dialogue policyの質問優先順位
- scheduler、preferred window、capacity計算
- preview authorization、approval、save
- UI、CSS

## 12. 受け入れ条件

- Stable V5の正常な質問・案内がAI rendererを通る。
- AIはaction identity、question code、target、質問数、preview可否を変更できない。
- AI出力が不正、危険、無関係、過長、時刻・日付を捏造した場合は既存文へfallbackする。
- semantic provider failure、normalization rejection、canonicalization rejection、duplicate suppressionではrendererを呼ばない。
- AI文面を採用しても`lastQuestionContext`はdeterministic question codeのまま維持する。
- traceで`ai`、`deterministic_fallback`、`system`を区別する。
- scheduler、Fact Graph、preview候補に差分を生じさせない。

## 13. テスト観点

- unit:
  - strict JSONの正常採用
  - action ID不一致、invalid JSON、禁止内容、過長文のfallback
  - fallbackにない時計時刻・相対日付の追加拒否
  - 引用taskとpreview件数の保持
- integration:
  - Stable V5質問文のAI採用
  - AI失敗時のdeterministic fallback
  - semantic failure時にrenderer未呼出し
  - `state.questions`と表示文の同期
- trace:
  - response sourceの明示保存
  - renderer decisionのdebug trace
- regression:
  - preview、normalization rejection、duplicate suppression
- browser/manual:
  - 実APIでの自然さとlatency

## 14. リスク

- turnごとにAI呼出しが一回増え、latencyとAPI costが増える。
- 自由文を許しすぎるとquestion targetや安全境界を変える。
- validatorを厳しくしすぎるとfallback率が高くなり、自然さが改善しない。
- 表示文だけ変更してquestion contextを更新しないと次turnの短答解釈と不一致になる。

## 15. Dependencies

- Issue #101
- Stable V5 runtimeとtrace v2
- 旧AI rendererは設計参考としてのみ使用し、legacy stateへ依存しない。

## 16. Exit conditions

- 実装とfocused testを追加する。
- 実行可能なtypecheck、test、buildを実行し、結果を記録する。実行できないものは未実施と明記する。
- 七視点事後確認でBLOCKER／MAJORが残らない。
- taskを`docs/ai/tasks/closed/`へ移す。
- 一つのbranchと一つのPRへ集約する。

## 17. 実装担当への指示

1. `docs/ai/weekly-planning-docs-index.md`から現行文書を確認する。
2. semantic normalizerへ返答生成を混ぜない。
3. rendererは決定済みactionの文章化だけを行う。
4. validation failureを利用者入力の責任にしない。
5. scope外の停止バグを同じPRで修正しない。
6. test結果、変更file、未確認事項をPRへ残す。
