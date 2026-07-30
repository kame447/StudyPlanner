# Stable V5 AI dialogue renderer 七視点監査

Status: implementation baseline
Date: 2026-07-30
Reviewed main: `475994440b86f7a2992f3e640b192b7f9cd21f36`
Issue: #101
Branch: `agent/stable-v5-ai-dialogue-renderer`

## 1. 監査対象と結論

対象は、Stable V5でdeterministic coreが決定した質問・案内を利用者向け文章へ変換する境界である。意味解釈、Fact Graph更新、readiness、scheduler、preview authorization、approval、saveは対象外とする。

現行production pathは次である。

```text
NaturalLanguageAssistant
→ executeWeeklyPlanningTurn
→ executeWeeklyPlanningStableV5RuntimeTurn
→ single AI semantic normalizer
→ validator / canonicalizer / Fact Graph V5
→ generic scheduler input compiler
→ decideWeeklyPlanningStableDialogueV5
→ runtime内のrenderQuestion switchまたは固定文字列
→ assistant message
```

旧legacy pathには次の境界が実在する。

```text
deterministic dialogue decision / questionPlan
→ createDialogueRenderInput
→ createAiWeeklyPlanningDialogueRenderer
→ structured JSON questions
→ sanitizeDialogueRenderOutput
→ AI output採用またはdeterministic fallback
```

したがって欠けているのはAIによる意味判断ではなく、Stable V5の決定済みdialogue actionを自然な日本語へ文章化する接続である。旧rendererの責務分離、structured output、identity検証、grounding検証、fallbackは再利用価値がある。一方、旧rendererのinputはexam中心の`PlanningIntakeState`とslot registryへ結合しているため、そのままStable V5へ接続してはならない。Stable V5向けの汎用action contractを新設する。

## 2. 視点1: 責務境界・architecture

### 確認事実

- `weeklyPlanning-current-contract-v5.md`は、AI semantic normalizerが質問target、missing優先順位、preview gateを決めないと定めている。
- `weeklyPlanningStableDialoguePolicyV5.ts`はblocking issueをdomain priorityで一件選び、question code、fact ID、detailsを返す。
- `weeklyPlanningStableV5RuntimeExecutor.ts`はその後の文面を`renderQuestion`のswitchとbranch別固定文字列で直接生成する。
- 旧`weeklyPlanningAiDialogueRenderer.ts`は「アプリが何を聞くか決め、AIは文面だけを書き換える」と明示している。

### 判定

Semantic normalizerへ返答生成を混在させる案は不採用とする。意味文書とユーザー向け文章のschema、失敗条件、再試行、traceが混ざり、normalizer failure時の境界も壊れる。

### 不変条件

- question code、target fact、dialogue branch、preview可否はcoreが決定する。
- AI rendererはstate mutation、質問追加、質問削除、scheduler判断、保存判断を行わない。
- renderer失敗はaccepted Graphを変更しない。

## 3. 視点2: grounding・安全性

### 確認事実

旧rendererはslot件数、slot identity、順序、重複、禁止内容、slot別groundingを検証し、失敗時はfallbackする。Stable V5の固定文には同等の外部出力検証境界がない。

### 必要契約

AI renderer inputはraw user textやprivate state全体ではなく、次だけを渡す。

- deterministic action ID
- action kind
- question code
- target label
- 認識済みtask titleの限定一覧
- preview件数等、その文章に必要な公開数値
- deterministic fallback文
- style constraint

AI outputはaction IDと本文だけを返す。次を検証する。

- action ID完全一致
- 空文字、過長、Markdown、URL、秘密情報要求の拒否
- action kindに応じた質問／案内のgrounding
- target labelまたは認識済みtaskの保持
- fallback文に存在しない時計時刻の追加拒否
- preview作成済み等、branchと矛盾するclaimの拒否

## 4. 視点3: 対話UX・自然さ

### 確認事実

Stable V5の正常turnはtrace上`responseSource: rules`であり、質問はswitchの同一文面を繰り返す。特に`quantity_role_unresolved`等で、ユーザーの直前表現や会話の調子を使わず、内部問題コードを一つのテンプレートへ射影している。

### 修正方針

AIには会話履歴全体を渡さず、coreが確定したactionの文章化に必要な最小contextを渡す。自然さは語順、短い受理表現、言い換えに限定し、質問内容や必要条件は変更させない。

一つのturnで原則一つの質問というStable V5 policyを維持する。AIが複数質問を追加した場合はfallbackする。

## 5. 視点4: failure・fallback・latency

### 確認事実

旧rendererは例外またはinvalid outputでdeterministic fallbackへ戻る。Stable V5 normalizer failure文はprovider／schema／canonicalization failureを区別している。

### 修正方針

- semantic provider failure、normalization rejection、canonicalization rejection、duplicate suppressionはrendererへ渡さずsystem文を維持する。
- semantic成功後の正常branchだけrendererを呼ぶ。
- renderer provider failure、JSON failure、schema failure、grounding failureは既存固定文へ戻す。
- renderer failureのために利用者へ再送を要求しない。
- rendererは一回だけ呼び、repair再試行を行わない。返答文のためにturn latencyを無制限に増やさない。

## 6. 視点5: state・question context・短答結合

### 確認事実

Stable V5 compatibility stateの`lastQuestionContext`はquestion codeから構築される。短答結合は表示文の一部を参照する経路も残るため、AI文面の自由化でquestion identityを失うと次turnの解釈を壊し得る。

### 修正方針

- `lastQuestionContext.targetSlot`と`intent`はAI textではなくdeterministic question codeから保存する。
- AI outputからquestion codeやtargetを逆算しない。
- contextual question inferenceが固定substringだけへ依存する問題は本Issueでは拡張しないが、renderer導入後もquestion codeをstate／traceへ明示してtext依存を増やさない。
- 進行停止バグである複数workloadへの短答結合は別Issueで扱い、本差分へ混在させない。

## 7. 視点6: observability・trace

### 確認事実

現行turn diagnosticのresponse sourceはbranchとerrorから推定され、正常branchは常に`rules`になる。rendererを接続しても明示情報を追加しなければ、AI採用とfallbackを区別できない。

### 修正方針

- execution resultへ`responseSource`を追加する。
- `ai`、`deterministic_fallback`、`system`をbranchごとに明示する。
- turn trace inputからdiagnosticへ明示sourceを渡し、推定はlegacy fallbackとして残す。
- debug traceへrenderer request、raw response、validation／fallback reasonを記録する。
- API key等のcredentialは記録しない。

## 8. 視点7: test・documentation・GitHub hygiene

### 必要test

- renderer unit: strict response、action ID一致、自然文採用
- renderer unit: invalid JSON、wrong action、禁止内容、時刻捏造、ungrounded textのfallback
- runtime integration: `ask_question`でAI文面を採用しquestion contextはdeterministic codeを維持
- runtime integration: recognized tasksの不足量質問をAI化
- runtime integration: renderer failure時に既存定型文を使用
- runtime integration: semantic failure時はrendererを呼ばない
- trace regression: AI採用とdeterministic fallbackのresponse sourceを区別
- existing preview、normalization rejection、Fact Graph、scheduler testを維持

### GitHub hygiene

- 同一目的のopen Issue／PRは確認できなかった。
- Issue #101、branch `agent/stable-v5-ai-dialogue-renderer`、一つのPRへ集約する。
- PR #99は再質問とsemantic repairの別論理タスクであり、再利用しない。
- 進行停止バグ、preferred window配置、semantic schema変更は混在させない。

## 9. 実装対象

新規:

- `src/features/weeklyPlanning/dialogue/weeklyPlanningStableV5AiDialogueRenderer.ts`
- `src/features/weeklyPlanning/dialogue/weeklyPlanningStableV5AiDialogueRenderer.test.ts`

変更:

- `src/features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeExecutor.ts`
- `src/features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeExecutor.test.ts`
- `src/features/weeklyPlanning/weeklyPlanningTurnExecutor.ts`
- `src/features/weeklyPlanning/application/weeklyPlanningTurnSideEffects.ts`
- `src/features/weeklyPlanning/trace/weeklyPlanningStableV5TraceRuntime.ts`
- `src/features/weeklyPlanning/trace/weeklyPlanningTurnDiagnosticV2.ts`
- trace関連test
- current contract、architecture、roadmap

## 10. 受け入れ条件

- Stable V5の正常な質問・案内branchがAI rendererを通る。
- coreが決定したaction identity、question code、target、preview可否はAI出力で変わらない。
- AI出力が不正、危険、無関係、過長、時刻捏造を含む場合は既存固定文へfallbackする。
- semantic／system failure文はrendererへ渡さない。
- `lastQuestionContext`はdeterministic question codeを維持する。
- traceで`ai`と`deterministic_fallback`を区別する。
- scheduler、Fact Graph、preview、approval、saveの意味結果は変更しない。
- 実行していないtest、typecheck、buildを成功と記録しない。
