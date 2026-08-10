# 週間計画 人間レビュー付き実API会話改善ループ

Status: active / P0 verification and quality loop
Date: 2026-08-10
Issue: #108
PR: #109
Branch: `agent/weekly-ai-conversation-eval`

## 目的

Stable V5の週間計画について、実際のOpenAI APIを使った複数ターン会話を一発話ずつ進め、各turnを開発エージェントがtranscriptと内部状態の両方からレビューする。明確な問題があれば、そのまま次turnへ進まず、原因層を特定して一般化した修正を行い、同じ会話地点を再検証する。

最終的な会話品質の意思決定は人間が行う。ただし、人間へ提示する前に、開発エージェント自身が明確な不自然さ、文脈破綻、意味誤認、重複質問、状態矛盾、予定生成上の欠陥を除去し、一定水準まで改善する。

## 非目的

- 特定の日本語返答を正解文として固定すること
- AIの自然言語理解を固定scenario oracleで自動採点すること
- transcriptを別AIに点数化させて合否を決めること
- 一つの失敗発話だけを通すregex、keyword、辞書、subject名、単位列挙をproductionへ追加すること
- 開発エージェントの文体好みだけを理由にrendererを過剰調整すること
- 新しいbranchまたはPRへ作業を分離すること

## 固定構成

現時点の採用構成は次とする。

```text
mini前処理
→ gpt-5.4-mini semantic
→ deterministic validator
→ validation failure時のみ gpt-5.4-mini repair 最大1回
→ formal binding / Fact Graph / dialogue / scheduler
→ gpt-5.4-mini renderer
```

Lunaは通常経路へ入れない。mini repairでも解けない実測難例が蓄積し、成功1件あたりのtoken、実費、latencyを含めて昇格の価値が示された場合だけ再評価する。

semantic ambiguityはrepairで無理に確定させない。意味として曖昧ならclarification対象であり、schema/validatorの構造違反とは別に扱う。

## 責務境界

自然言語、会話文脈、省略、照応、訂正、承認、数量の役割、日付の係り先などの意味理解はAIが担当する。

deterministic codeは、schema、型、reference、revision、owner、formal target、transaction、readiness、scheduler、preview、approval、save、persistence、安全境界を担当する。raw user textを読み直してAIの意味を上書きしない。

rendererはmachine-readableなapplication decisionと会話状態を自然な利用者向け日本語へ変換する。renderer文面から逆に状態や意味を推定しない。

## turnレビュー手順

各実API turnの後、次の順序で確認する。

1. AIへ渡したcontextが十分で、古い状態や誤ったpending questionを渡していないか。
2. semantic raw responseはユーザーの発話と会話文脈を妥当に理解しているか。
3. raw responseの意味をschemaが損失なく表現できるか。
4. validatorが正しい意味を誤拒否していないか、または本来拒否すべき構造を見逃していないか。
5. repairがvalidatorの指摘範囲を正しく直し、別の意味を勝手に変更していないか。
6. formal ID binding、Fact Graph lifecycle、pending question、revisionで対象が壊れていないか。
7. dialogue decisionが、今このturnで聞くべきこと・実行すべきことを適切に選んでいるか。
8. rendererがdecisionを忠実かつ自然に表現し、内部用語、重複、不要な説明、誤った具体化を追加していないか。
9. preview、訂正、再preview、承認、保存まで進んだ場合、旧状態の混入やstale approvalがないか。

この順序を飛ばして、最初にpromptや日本語ルールを変更しない。

## 問題分類と修正先

### A. semantic context不足

症状: 前turnで得た情報を忘れる、直前質問と回答の対応を誤る、既存Factを知らない前提で解釈する。

修正先: semanticへ渡す会話履歴、machine-readable state、pending question context。個別発話のルールは追加しない。

### B. semantic raw responseの意味誤り

症状: 十分なcontextがあるのに対象、数量役割、日付、訂正意図などを誤解する。

修正先: semantic prompt、semantic contract、必要ならモデル構成。特定語句patchではなく、同型の言い換えにも効く一般原則として修正する。

### C. schema表現力不足 / validator誤り

症状: raw semanticは正しいがschemaに載らない、validatorが誤拒否する、または構造上危険な出力を通す。

修正先: schema、validator、reference contract。raw user textの再解釈で補わない。

### D. repair不良

症状: validator feedbackを直せない、無関係な意味まで変更する、同じ違反を繰り返す。

修正先: repair prompt/context/feedback representation。repairは最大1回のままにし、再帰的retryを追加しない。

### E. formal binding / Graph不良

症状: semanticは正しいのに別taskへ数量を結び付ける、訂正対象を取り違える、既存Factが消える、revisionが壊れる。

修正先: ID binding、transaction、Graph lifecycle。意味を選び直さない。

### F. dialogue decision不良

症状: 既に答えたことを再質問する、まだ不要な情報を先に聞く、曖昧点ではない別項目を聞く、予定作成可能なのに質問を続ける。

修正先: machine-readable missing/readiness/question policy。rendererの文面変更だけで隠さない。

### G. renderer不良

症状: machine decisionは正しいが、返答が不自然、機械的、冗長、前turnとつながらない、内部状態を露出する、質問を複数混ぜる。

修正先: renderer context/prompt/typed action contract。semanticやFact Graphは触らない。

### H. preview / approval / persistence不良

症状: 訂正がpreviewへ反映されない、旧previewを承認できる、二重保存、再読込で会話が分裂する。

修正先: deterministic transaction、preview lifecycle、approval、persistence。AI promptで回避しない。

## 修正を行う基準

次は原則としてそのturnで停止して修正する。

- ユーザー意図の明確な取り違え
- 既に与えた情報の不必要な再質問
- 直前の質問への回答を無視する
- 別task・別数量・別日付への誤binding
- 曖昧なのに勝手に一意化する
- 根拠のない条件・時間・数量を生成する
- ユーザーが次に何を答えればよいか分からない
- 会話上明らかに不自然な同文反復
- 内部用語やschema都合を利用者へ押し付ける
- previewや保存状態と発話が矛盾する

一方、意味・文脈・次行動が妥当で、単なる言い回しの好みの差だけならproductionを変更しない。モデルの自然な表現幅を保持する。

## 修正方法の制約

修正は一つの失敗事例を通すためではなく、その原因クラスを解消する。

productionコードへraw user textを読む新しいregex、keyword list、辞書、subject名、数量・単位の列挙を追加しない。意味保存を機械的に保証できるcanonicalizationを追加する場合も、必要性を実測し、変更可能fieldを限定し、前後diffと再validationで意味変更がないことを保証する。現時点では広範なdeterministic repairは導入せず、mini repairを標準とする。

修正後は、決定論的に正誤を定義できる回帰だけ自動テストへ追加する。AIの返答文面やraw user textからの特定semantic結果を固定期待値にしない。

## 実API改善ループ

```text
人間相当の自然な発話を1turn投入
→ real APIでsemantic / 必要ならrepair / rendererを実行
→ transcript + raw semantic + accepted document + validator + Graph + decisionを確認
→ 明確な問題なし: checkpointを保持して次の自然な発話へ進む
→ 明確な問題あり: 次turnへ進まず原因分類
→ 一般化したproduction修正
→ deterministic regressionを必要な範囲だけ追加
→ 同じ会話地点を再実行
→ 問題が解消したら会話を継続
→ preview
→ 必要なら自然な訂正を1回以上実施
→ 再preview
→ 承認 / 保存
→ 最終transcriptを人間へ提示
```

同じ失敗を何度もprompt微調整で追いかけない。同一原因で2回修正しても安定しない場合は、局所prompt問題ではなくschema、state handoff、責務分離の設計問題として再棚卸しする。

## 自動テストとの境界

実API会話の自然さや意味理解そのものにPASS文面を置かない。ハーネスが機械的に失敗としてよいのはprovider failure、turn rejection、state corruption、checkpoint破損、request budget超過、必要なAI経路のbypassなどである。

会話品質は開発エージェントが途中レビューし、最終的には人間がtranscriptを読んで決定する。

## 受け入れ条件

- 同じPR #109 / `agent/weekly-ai-conversation-eval`で作業を継続している。
- mini semantic + validator + mini repair最大1回が標準経路である。
- 実API会話を一発話ずつ継続できる。
- 開発エージェントが各turnでtranscriptと内部状態を確認できる。
- 明確な問題があるturnは、未修正のまま先へ進めない。
- 修正が責務境界に沿い、scenario固有自然言語patchを増やしていない。
- 予定作成、preview、訂正、再preview、承認、保存まで実会話で到達する。
- 最終transcriptを人間へ提示し、人間が会話品質の最終判断を行える。

## 記録

各修正ループについて、少なくとも発話、観測された問題、原因層、修正内容、決定論的回帰の有無、再実行結果を本taskへ追記する。問題がなかったturnも最終transcriptで追跡できるようcheckpointを保持する。
