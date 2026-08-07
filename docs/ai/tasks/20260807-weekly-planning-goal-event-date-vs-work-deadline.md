# Weekly Planning: goal/event date と作業 deadline の分離

## 発見した問題

探索的な実API会話テストで、利用者が次のように発話した。

> 夏休みの課題もまだ終わってなくて、2週間後に共通テスト模試もあるので、その勉強も進めたいです。特に数学が結構まずいです。

Stable V5 normalizer は「共通テスト模試の勉強」をstudy taskとして受理した一方、

> 2週間後に共通テスト模試もあるので

を、その勉強taskの `hard deadline` としてcanonicalizeした。

これは「試験という出来事が2週間後にある」という事実と、「模試勉強を2週間後までに完了しなければならない」という作業制約を同一視している。

現行architectureでは `deadline` の例が「明日まで」のようなcompletion-by表現であり、temporal constraintはtaskがいつ行われる／完了するかを表す。したがって現在の解釈は意味的に強すぎる。

同時に、現行SemanticDocumentには「将来の試験日・提出日・大会日など、作業ではないが計画判断へ影響する目標イベント日」を独立して表現するfact kindが見当たらない。このため単純にdeadlineを外すだけでは「2週間後」という重要な計画文脈を失う。

## 7視点監査

### 1. 利用者発話の意味

「2週間後に模試がある」はイベント発生日を述べている。

「模試の勉強は2週間後までに終える」「模試までにこの範囲を終わらせる」であればwork deadlineだが、今回の発話にはそこまでのcompletion commitmentはない。

AIが計画上もっともらしいdeadlineを補うことは、`Do not invent facts` と衝突する。

### 2. semantic model

現行の中心概念はtask、component、workload、時間制約、relationである。

`SemanticTemporalConstraint` はtaskをtargetに持ち、`deadline` はtask completion-byを表す。試験日そのものをここへ入れると、将来schedulerがその制約をwork completion deadlineとして扱う危険がある。

一方、goal/event date専用のfact kindは現行V5 schemaにはない。

### 3. scheduler・優先順位

試験日や提出日は、残り日数を基にpriorityやpaceを考える重要情報になり得る。

そのため「deadlineではないから捨てる」だけでは、将来の計画立案に必要な文脈を消す可能性がある。

ただし、event dateから自動でhard work deadlineを生成することも禁止する。必要なら別のplanning policyがevent dateを参照し、提案や質問へ使うべきである。

### 4. 会話設計

利用者がイベント日だけを述べた場合、アプリはその意味を保持したうえで、必要なら「模試までにどこまで進めたいか」を別途確認できるべきである。

イベント日をすでにwork deadlineとみなすと、この確認を飛ばしてしまい、利用者が意図していない完了条件を内部で確定する。

### 5. fail-closed・AI ownership

後段のdeterministic codeが「試験という語だからdeadlineではない」とraw textを再解釈する修正は、single AI semantic ownershipに反する。

AI promptだけで今回の表現を捨てさせることは可能だが、event dateを保持できないschema gapを隠す危険がある。

したがって、semantic representationの方針を先に確定する必要がある。

### 6. 回帰・汎化

対象は模試だけではない。

同じ問題は「2週間後に定期試験がある」「来月TOEICがある」「金曜に発表がある」「月末に大会がある」「8/10に論文提出がある」などで発生する。

特定の試験名や「2週間後」をpromptへ例外追加する修正は禁止する。

また、「提出締切」のようにイベント日とwork completion deadlineが実質一致するケースもあるため、すべての未来イベント表現からdeadlineを除く単純ルールにもしてはいけない。

### 7. storage・互換性・変更規模

新しいgoal/event fact kindを追加する場合、schema、validator、canonical Fact Graph、publicStateSummary、trace、readiness、scheduler入力境界、storage serializationまで影響範囲を監査する必要がある。

一方、現段階でevent dateをsemantic deltaから落とすだけなら変更は小さいが、利用者が明示した重要情報を失う設計判断になる。

この選択はテストケースだけから決めず、StudyPlannerの製品思想として決める必要がある。

## 現時点で確定できる不変条件

- 「イベントがX日にある」だけでは、その準備taskのhard deadlineを確定しない。
- 「X日までにこの作業を終える」はwork deadlineとして扱う。
- AIはイベント日から暗黙のcompletion commitmentを作らない。
- validatorを緩めて誤ったdeadlineを通す方向にはしない。
- 特定の「模試」専用分岐は作らない。

## 未確定の設計判断

### 案A: goal/event dateを新しいfactとして保持する

例として `goal_event` / `milestone` のようなfactを追加し、名称、日付表現、関連taskを保持する。

長所:
- 利用者が明示した将来イベントを失わない。
- 残り日数や優先度、逆算提案へ将来使える。
- work deadlineと意味を分離できる。

短所:
- V5 schemaからFact Graph、public summary、storage等まで変更範囲が大きい。
- schedulerへどう影響させるかを別途設計する必要がある。

### 案B: 現行V5ではevent dateをfact化せず、work deadlineではないものは保持しない

長所:
- 変更範囲が小さい。
- 誤ったhard constraintを作らなくなる。

短所:
- 「2週間後」という利用者の重要情報を捨てる。
- 後で残り日数を使った提案をするために再質問が必要になる。

## 実装開始条件

上記A/B、または別の既存表現を採用するかを製品方針として確定してから実装する。

実装後は最低限、次の概念レベルで並列なケースを回帰確認する。

- 試験日だけを述べる
- 試験までに特定範囲を終えると述べる
- 提出締切を述べる
- 単なる予定イベント日を述べる
- softな目標日を述べる

その後、実API会話のturn 2を直前成功checkpointから再実行し、内部factと利用者向け返答を再監査する。
