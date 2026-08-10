# Weekly Planning: cross-turn entity binding と recurrence 整合性

Status: active
Date: 2026-08-07
Trigger run: `31168512531`
Last good checkpoint: turn 2 run `31168266197`

## 発見した問題

turn 3 で利用者は、直前に登録済みの2 taskを自然に継続参照した。

> 夏休みの課題は、できれば来週で半分くらいまで進めたいです。模試の方は数学を中心に、毎日2時間くらい取れたらと思ってます。

利用者向け返答自体は自然だった。

> 夏休みの課題を来週で半分くらい進めるには、合計でどれくらい時間がかかりそうですか？

しかしGraphでは、turn 2に存在する

- `夏休みの課題`
- `共通テスト模試の勉強`
- component `数学`

へworkloadを追加せず、turn 3で同名task/componentをもう1組新規作成した。

さらに `毎日2時間くらい` は

```text
workload.amount=2
unitCode=hour
perOccurrence=true
periodExpression=daily
```

まで解釈した一方、`recurrence=daily` を生成しなかった。

このturnはworkflow greenでもsemantic stateとして不採用とする。

## 7視点監査

### 1. 会話意味

「夏休みの課題は」「模試の方は」は、直前会話で導入済みの対象への継続参照であり、新しい別taskの導入ではない。

通常の対話では、task名を毎turn新規entityとして扱ってはならない。ユーザーが新しい対象を追加した場合と、既存対象へ量・時間・制約を追加した場合をsemantic層で区別する必要がある。

### 2. 現行schemaの欠落

現行 `SemanticTaskV5` / `SemanticStudyComponentV5` はresponse-local `localId` しか持たない。

そのためAIが「これは既存task/componentへの追加情報」と理解しても、それを表すfieldがなく、canonicalizerは全task/componentを新規Factとして登録するしかない。

correctionは明示的な訂正専用であり、単なる継続説明をcorrectionへ流用しない。

### 3. 採用するentity binding

各task/componentに、既存Fact参照を明示するfieldを追加する。

```ts
existingPublicId: string | null
```

意味:

- `null`: current turnで新規導入されたentity
- exact public ID: `publicStateSummary` 内の既存active entityを継続参照

AIはpublic IDを発行しない。applicationが公開したexact IDをechoするだけであり、owner/revision/private metadataをAIに委譲しない。

### 4. canonicalization

`existingPublicId` が指定されたtask/componentは新規Factを作らない。

response-local `localId` を既存Fact IDへmapし、そのlocalIdをtargetにした新しい

- workload
- effort estimate
- temporal constraint
- recurrence
- 新規子component

だけをcurrent revisionへ追加する。

既存taskのstudy contextも再作成しない。

検証条件:

- public IDがactiveである
- kindがtask/componentで一致する
- bound componentはresolved containing taskに所属する
- stale/unknown/wrong-kind/cross-task IDはreject

ラベル近似・sourceText・配列位置で既存IDをcoreが推測してはならない。

### 5. AI契約とfail-closed

provider schemaでは `existingPublicId` をtask/componentの必須fieldにする。新規なら必ずnull。

prompt:

- current userがpublicStateSummaryの既存entityを継続して説明している場合はexact existingPublicIdを使う
- workload等を追加するためだけに既存task/componentを複製しない
- 同名だからという理由だけで勝手にbindせず、会話上同じ対象と解釈できる時だけbind
- 不確実ならuncertaintyを返す

normalizerはinput `publicStateSummary` に対してexact public-ID存在/kind/ownership relationだけを検証する。raw user textからbindingを推測しない。

### 6. recurrence整合性

現行prompt自身が「毎日30分」を `recurrence=daily` + per-occurrence workload と定義しているのに、turn 3では `periodExpression=daily` のみになった。

`periodExpression` はworkloadの期間scopeであり、反復頻度の代替ではない。

structured consistency rule:

- workload `perOccurrence=true`
- workload `periodExpression` が `daily` / `weekdays` / `weekends` の明示recurrence token

である場合、同じtask/component targetにmatching recurrenceが必須。

不足時はsemantic validation errorとして同じAI repairへまとめて返す。coreがraw textからrecurrenceを生成しない。

promptも「explicit recurrenceはrecurrenceに格納し、periodExpressionだけで代用しない」と明確化する。

将来、`weekly` + days等も同じ整合性層を拡張できるが、曖昧なperiodExpression文字列から頻度を推測しない。

### 7. scheduler・回帰・観測性

重複taskを許すと、同じ課題が別work itemとして二重計上され、質問・preview・保存も分裂する。これはscheduler前に止めるべきsemantic/canonicalization問題である。

recurrenceは現在GenericSchedulerInputで十分活用されていない部分があっても、Fact Graph上の意味を欠損させてよい理由にはならない。将来schedulerがrecurrenceを使用した時に意味が変わらないよう、semantic factとして正しく保持する。

最低限の回帰:

1. 既存taskへ新workload追加 → task数増加なし
2. 既存componentへ新workload追加 → component数増加なし
3. 既存task + 新component → task再作成なし、新componentのみ追加
4. unknown/stale/wrong-kind existingPublicId → reject
5. component existingPublicIdが別task所属 → reject
6. 新規task/component existingPublicId=null →従来どおり作成
7. corrections semanticsは変更しない
8. `毎日2時間` 相当 structured outputでmatching daily recurrenceなし → repair対象
9. matching daily recurrenceあり → accepted
10. user-side evalはpublic IDを見ない。bindingはruntime semantic AI内部だけで行う

## turn 3 再検証条件

last good turn 2 run `31168266197` から、同じturn 3発話を再実行する。

合格条件:

- Graphのactive taskは引き続き2件
- `夏休みの課題` 既存taskにhalf target workloadが追加
- `共通テスト模試の勉強` の既存 `数学` componentに2h workloadが追加
- `daily` recurrenceが同じ対象へ追加
- turn 2のgoal_event/concernが保持される
- app responseにfailureがない

満たさない場合はturn 4へ進まない。
