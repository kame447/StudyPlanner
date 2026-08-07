# Weekly Planning: goal/event date と作業 deadline の分離

## 発見した問題

探索的な実API会話テストで、利用者が次のように発話した。

> 夏休みの課題もまだ終わってなくて、2週間後に共通テスト模試もあるので、その勉強も進めたいです。特に数学が結構まずいです。

Stable V5 normalizer は「共通テスト模試の勉強」をstudy taskとして受理した一方、

> 2週間後に共通テスト模試もあるので

を、その勉強taskの `hard deadline` としてcanonicalizeした。

これは「試験という出来事が2週間後にある」という事実と、「模試勉強を2週間後までに完了しなければならない」という作業制約を同一視している。

現行architectureでは `deadline` の例が「明日まで」のようなcompletion-by表現であり、temporal constraintはtaskがいつ行われる／完了するかを表す。したがって現在の解釈は意味的に強すぎる。

同時に、現行SemanticDocumentには「将来の試験日・提出日・大会日など、作業ではないが計画判断へ影響する目標イベント日」を独立して表現するfact kindがない。このため単純にdeadlineを外すだけでは「2週間後」という重要な計画文脈を失う。

## 7視点監査

### 1. 利用者発話の意味

「2週間後に模試がある」はイベント発生日を述べている。

「模試の勉強は2週間後までに終える」「模試までにこの範囲を終わらせる」であればwork deadlineだが、今回の発話にはそこまでのcompletion commitmentはない。

AIが計画上もっともらしいdeadlineを補うことは、`Do not invent facts` と衝突する。

また「特に数学が結構まずい」は、今週だけのscheduler制約ではなく、次回以降の計画でも優先順位や確認質問に使える利用者文脈である。

### 2. semantic model

現行の中心概念はtask、component、workload、時間制約、relationである。

`SemanticTemporalConstraint` はtaskをtargetに持ち、`deadline` はtask completion-byを表す。試験日そのものをここへ入れると、将来schedulerがその制約をwork completion deadlineとして扱う危険がある。

一方、利用者本人に属する長期文脈を週別Fact Graphへ混ぜると、「今週の計画条件」と「次回にも再利用すべき履歴」が同一ライフサイクルになる。

したがって週別Graphとは別に、owner単位の `UserPlanningContextSpace` を設ける。

### 3. scheduler・優先順位

試験日や提出日は、残り日数を基にpriorityやpaceを考える重要情報になり得る。

ただし、goal/event dateから自動でhard work deadlineを生成しない。schedulerへ直接hard constraintとして流さず、将来のplanning policyや対話AIが参照する文脈とする。

必要なら「模試までにどこまで進めたいか」を別途確認し、その回答によって初めてwork deadline / workload targetを生成する。

### 4. 会話設計

利用者がイベント日や継続的な不安・優先事項を述べた場合、アプリはその情報を保持したうえで、現在の週間計画には必要な追加条件だけを聞く。

次回の計画では、保持情報を使って「前回、共通テスト模試が近く数学を優先したいと話していましたが、今週も数学を厚めにしますか」のような精度の高い確認が可能になる。

ただし過去情報を現在のhard constraintとして黙って再適用しない。過去文脈は提案・確認材料であり、現在turnの明示条件とは区別する。

### 5. fail-closed・AI ownership

後段のdeterministic codeが「試験という語だからdeadlineではない」とraw textを再解釈する修正は、single AI semantic ownershipに反する。

同じsemantic normalizerのstructured outputに、週間Factとは別の `userContextFacts` を追加する。これにより追加AI呼び出しなしで、同じ意味解釈主体が

- 今週のtask/workload/constraint
- 利用者に長期保持すべき文脈

を分離して返せる。

validatorは型・参照・sourceText groundingだけを検証し、意味を再解釈しない。

### 6. 回帰・汎化

対象は模試だけではない。

同じ設計で次を扱えるようにする。

- 2週間後に定期試験がある
- 来月TOEICがある
- 金曜に発表がある
- 月末に大会がある
- 研究の締切が近い
- 数学が苦手／英語を優先したい
- 朝の方が集中しやすい等、今後の計画にも効く利用者傾向

特定の試験名や「2週間後」専用分岐は禁止する。

また「8/10までに論文を提出する」のような明示completion-byはwork deadlineとして保持し得る。goal eventとwork deadlineが同日でも、意味上は別factとして共存可能とする。

### 7. storage・互換性・変更規模

`UserPlanningContextSpace` はweekStartDateではなくownerIdをキーにする。週間セッションを削除・切替しても消えない。

各recordは最低限、次を持つ。

- stable record id
- kind
- ownerId
- label / value
- dateExpression（該当時）
- sourceText
- sourceConversationId
- sourceTurnId
- observedDate（相対日付の基準日）
- recordedAt
- status (`active` / `historical`)

相対日付を文字列だけで保存すると、次週に「2週間後」の基準がずれるため `observedDate` を必須にする。解決可能な日付はcore側で絶対日付へ解決して併記してよいが、解決不能なcustom表現を勝手に推測しない。

保存はowner境界、サイズ上限、unknown field拒否、壊れたpayloadのfail-closedを週間session storageと同等に持つ。

## 採用方針

### UserPlanningContextSpace を新設する

週別 `PlanningFactGraphV5` とは独立した、owner単位の長期文脈ストアを作る。

初期fact kindは以下とする。

#### `goal_event`

試験、発表、大会、面談など「その日自体に出来事がある」情報。

例:

```text
2週間後に共通テスト模試がある
→ kind=goal_event
→ label=共通テスト模試
→ dateExpression=custom:2週間後
→ observedDate=2026-08-07
```

このfactだけではwork deadlineを生成しない。

#### `concern`

次回以降の計画でも優先順位・確認質問に有用な、利用者の継続的な懸念や重点。

例:

```text
特に数学が結構まずい
→ kind=concern
→ label=数学
→ value=学習上の不安・優先度が高い
```

### semantic contract

Stable V5 SemanticDocumentに `userContextFacts` を追加し、同じAI normalizerが抽出する。

- event occurrence dateは `userContextFacts.goal_event`
- explicit completion-byはtask `temporalConstraints.deadline`
- concern等の長期文脈は `userContextFacts.concern`
- current userTextにない過去contextを再出力しない
- public user contextは参照用であり、そのままcurrent weekly factへコピーしない

### lifecycle

1. AI normalizerがcurrent turnのsemantic deltaとuserContextFactsを返す。
2. schema / source evidence validationを通す。
3. weekly graph canonicalizationが成功したturnだけ、user contextもcommitする。
4. user contextはowner単位storeへupsertする。
5. 次回以降のnormalizerへbounded summaryとして渡す。
6. 期限を過ぎたgoal_eventは削除せずhistoricalへ移し、通常promptへはactive中心で渡す。

weekly graphとuser contextのどちらかだけが失敗turnで更新される状態は禁止する。

## 確定不変条件

- 「イベントがX日にある」だけでは、その準備taskのhard deadlineを確定しない。
- 「X日までにこの作業を終える」はwork deadlineとして扱う。
- event dateとwork deadlineは別conceptである。
- AIはイベント日から暗黙のcompletion commitmentを作らない。
- 利用者に長期的に有用な情報は週別Graphではなくowner単位contextへ保存する。
- 過去contextは現在のhard constraintとして黙って再適用しない。
- failed/rejected turnではweekly graphもuser contextも更新しない。
- 特定の模試・科目・日付専用patchは作らない。

## 実装・検証条件

最低限、次を回帰確認する。

- 試験日だけを述べる → goal_event、work deadlineなし
- 試験までに特定範囲を終える → goal_eventと明示work deadlineを区別
- 提出締切を述べる → 文意に応じたwork deadline
- 単なる予定イベント日を述べる → goal_event
- 「数学がかなり不安」 → concern
- 翌週の新conversationでowner contextが読み込まれる
- owner Aのcontextがowner Bへ漏れない
- 壊れた/巨大context payloadをfail-closedで拒否
- failed semantic turnでcontextが更新されない

その後、実API会話turn 2を直前成功checkpointから再実行し、

- `2週間後の共通テスト模試` がhard deadlineになっていない
- goal_eventとしてowner contextへ保存されている
- 数学のconcernが保持されている
- 利用者向け返答が不自然に悪化していない

ことを確認してからturn 3へ進む。
