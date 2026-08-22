# Stable V5 AI dialogue renderer 事後七視点監査

Status: implementation complete / automated verification pending
Date: 2026-07-30
Issue: #101
PR: #102
Branch: `agent/stable-v5-ai-dialogue-renderer`
Reviewed head: `ab8b37592fc5114f9b5cd5d15373a4bf6c51b933`

## 1. 結論

Stable V5のdeterministic coreが決定した質問・案内を、独立したAI dialogue rendererで文章化する接続は実装済みである。semantic normalizer、Fact Graph、dialogue policy、scheduler、preview、approval、saveの決定権はAI rendererへ移していない。

事後監査でBLOCKERは確認されなかった。MAJOR相当の未修正コード問題も確認されなかった。ただしGitHub Actionsの`verify` jobは実行stepを一件も開始せず終了しており、focused test、typecheck、full testを成功とは判定できない。Cloudflare Pagesのbranch preview buildは最新headで成功しているが、これは`vite build`相当の配信build確認であり、`npm run verify`の代替ではない。

したがってPR #102はdraftを維持し、Actions利用枠の回復後または人間のローカル環境で`npm run verify`を実行するまでmerge readyにはしない。

## 2. 視点1: 責務境界・architecture

判定: pass

`executeWeeklyPlanningStableV5RuntimeTurn`が従来どおりsemantic解釈、canonicalization、scheduler compilation、dialogue action選択、preview生成を担当し、その結果を返した後に`executeWeeklyPlanningTurn`が文面だけをAI rendererへ渡す構成になっている。

AI renderer inputはaction ID、action kind、question code、保持必須ラベル、deterministic fallback文、preview件数に限定される。AI rendererはFact Graph操作、question code変更、preview認可、保存判断を返せない。

旧legacy rendererの責務分離は再利用しているが、旧`PlanningIntakeState`や院試専用slot registryへの依存は復活させていない。

## 3. 視点2: grounding・安全性

判定: pass

出力はstrict JSONの`actionId`と`text`に限定される。action ID不一致、invalid JSON、shape不正、空文、過長文、Markdown、URL、設定変更誘導、秘密情報要求、医療的な危険内容はfallbackとなる。

質問codeごとに最低限保持すべき意味語を検証し、対象がある質問ではdeterministic文面から抽出した対象ラベルの完全保持を要求する。missing schedulable workでは認識済みtask titleだけを保持対象とし、`2時間`、`30ページ`、`20問`等の例示を対象として誤認しない。

fallback文に存在しない時計時刻または相対日付をAIが追加した場合もfallbackする。preview readyでは候補件数と`仮予定`の保持を要求する。

## 4. 視点3: 対話UX・自然さ

判定: pass with limitation

正常なStable V5返答はAI rendererを通り、固定文の意味を維持したまま自然な短い日本語へ言い換えられる。質問対象、質問数、質問種別はcoreが固定するため、自由会話モデルへ計画判断まで委譲する構成ではない。

今回のscopeは文章化境界のみであるため、`どういうこと？`等の説明要求を新しい対話actionとして選択する機能や、複数workloadへの短答結合は修正していない。これらは進行停止側の別Issueで扱う。

## 5. 視点4: failure・fallback・latency

判定: pass

semantic provider failure、normalization rejection、canonicalization rejection、duplicate suppression等のsystem結果はAI rendererを通さない。

AI rendererは一回だけ呼び、provider error、invalid output、grounding failureでは利用者へ再入力を要求せず、同じturnのdeterministic文面へ戻る。renderer失敗はFact Graph、scheduler結果、preview候補を変更しない。

正常turnごとにAI呼出しが一回増えるため、追加latencyとAPI costは残る。実APIでの遅延計測は未実施である。

## 6. 視点5: state・question context・短答結合

判定: pass

AI文面を採用した場合、表示用の`state.questions`だけを最終文面へ同期する。`lastQuestionContext.targetSlot`と`intent`はStable V5のdeterministic question codeをそのまま保持し、AI文面から逆算しない。

したがって文面の言い換えによってquestion identityが失われることはない。ただし既存のcontextual parserに残る固定substring依存や、複数未解決workloadへの回答binding不成立は本PRの対象外である。

## 7. 視点6: observability・trace

判定: pass

execution resultへ明示的なresponse sourceを追加し、`ai`、`deterministic_fallback`、`system`を区別する。turn diagnosticは従来の推定値より明示値を優先し、deterministic fallback時はsessionの`hasFallback`も更新する。

Stable V5 debug traceにはrenderer request、raw response、validation/fallback reason、最終decisionを記録する。credentialはrenderer inputへ含めない。

## 8. 視点7: test・documentation・GitHub hygiene

判定: implementation pass / execution pending

追加済みtestは、正常採用、action ID不一致、対象欠落、質問意味変更、時刻・日付捏造、preview件数、追加質問、invalid JSON、unsafe content、provider failure、question context維持、system bypass、trace response sourceを対象とする。

PR #102はIssue #101、branch `agent/stable-v5-ai-dialogue-renderer`へ集約されている。進行停止バグは混在していない。

Cloudflare Pagesのpreview deployはhead `ab8b375`で成功した。GitHub Actions CI run `30534302326`のverify job `90843752936`はconclusion failureだが、stepsとlogsが生成されていない。従ってtest失敗ではなく、実行基盤上の未実行として扱う。

## 9. 残作業

Actions利用枠回復後または人間のローカル環境で、次を実行する。

```sh
npm run typecheck
npm run test:run -- src/features/weeklyPlanning/dialogue/weeklyPlanningStableV5AiDialogueRenderer.test.ts src/features/weeklyPlanning/dialogue/weeklyPlanningStableV5DialogueContext.test.ts src/features/weeklyPlanning/weeklyPlanningTurnExecutor.test.ts src/features/weeklyPlanning/trace/weeklyPlanningTurnDiagnosticV2ResponseSource.test.ts
npm run test:run
npm run build
```

すべて通過した後、task Markdownをclosedへ移し、PRをready for reviewへ変更する。