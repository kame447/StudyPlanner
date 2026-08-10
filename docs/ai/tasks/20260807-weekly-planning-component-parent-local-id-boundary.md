# Weekly Planning: component parentLocalId 境界監査

Status: active
Date: 2026-08-07
Trigger run: `31167616401`

## 発見した問題

実API turn 2 の再検証で、AIは次の意味を正しく抽出した。

- task: `共通テスト模試の勉強`
- component: `数学`
- component durable concern: `結構まずい`
- goal event: `2週間後の共通テスト模試`

しかし、最上位component `数学` の `parentLocalId` に親taskのlocalIdを設定した。

現行Stable V5のcomponent modelでは `parentLocalId` はcomponent階層専用である。最上位componentは `null`、子componentだけが別componentのlocalIdを参照する。taskとの所属関係は `task.study.components` への包含ですでに表現されている。

legacy validatorはこの契約を正しく検出し、`parent-ref:<component>:<task>` として初回応答を拒否した。AI repairは `parentLocalId=null` に修正したが、そのrepair後に別の既知問題である event occurrence / work deadline の同一evidence二重分類が検出された。Stable V5 normalizerはAI repairを1回だけ許可するため、2つの独立した修正可能エラーが直列に現れ、turn全体がrejectedになった。

## 7視点監査

### 1. semantic model

`parentLocalId` はtask ownershipを表すfieldではない。

- task → component所属: JSONの包含関係
- component → 子component階層: `parentLocalId`

この2つを混同すると、taskをcomponent parentとして扱う不正なgraphになる。

### 2. AI prompt contract

現行promptの `Use parentLocalId for hierarchy.` は曖昧で、AIが「taskがcomponentの親」と解釈できる余地がある。

契約を次へ明確化する。

- `parentLocalId` may reference only another component localId in the same task
- top-level components use `null`
- never use task localId as `parentLocalId`

特定の数学・模試専用例は入れない。

### 3. deterministic normalization boundary

この誤りはraw user textの意味解釈を必要としない。

componentはすでに特定taskの `study.components` に包含されている。そのcomponentの `parentLocalId` が「まさに包含task自身のlocalId」である場合、その参照はmodel上不可能であり、表現しようとしている構造は一意に「task直下のtop-level component」である。

したがって、次の場合だけdeterministic normalizationを許可する。

```text
component.parentLocalId === containingTask.localId
→ component.parentLocalId = null
```

それ以外の不正parent referenceは変更しない。

禁止:

- 存在しない任意IDをnullへ変換
- ラベルやroleから親componentを推測
- fuzzy matching
- sourceText解析
- component順序から親子関係を推測

### 4. repair budget

Stable V5はprovider request budget上、semantic AI repairを1回に制限している。

完全に構造的・一意な正規化でrepairを消費すると、event/deadline ambiguityのような本当にAIの意味判断を必要とする問題を修復できない。

よってこのケースは既存のexact duplicate workload normalizationと同じ「AI意味解釈前提を変更しないalgorithmic normalization」層で処理する。

### 5. validator / fail-closed

normalization対象外のparent errorは引き続きvalidatorでrejectする。

例:

- component A parent=`missing-id` → reject
- component A parent=component A → cycle reject
- A→B→A → cycle reject
- 別taskのcomponent IDをparentに指定 → reject

validatorを緩めない。

### 6. 回帰・汎化

対象はあらゆるtask/componentに一般化する。

- 科目
- 教材
- chapter
- topic
- skill
- 非今回シナリオのstudy task

provider prompt自体も明確化するため、通常はAIが最初からnullを返すことを期待する。deterministic normalizationは防御層である。

### 7. 観測性・テスト

normalizationを行った場合はdiagnosticsの `algorithmicRepairs` に

```text
component-parent-task-reference-normalized:<taskLocalId>:<componentLocalId>
```

を記録する。

最低限のテスト:

1. containing task IDをparentにしたtop-level component → nullへ正規化
2. 正常なcomponent→component親子 →変更しない
3. 存在しないID →変更せずvalidatorへ渡す
4. invalid JSON →変更しない
5. normalizer統合でこの構造修正はAI repairを消費しない
6. promptにcomponent-only parent contractを明示
7. 特定シナリオ語をprompt/normalizerへ入れない

## 採用方針

- prompt contractを明確化する
- narrow deterministic normalizerを追加する
- validatorの厳格性は維持する
- AI repair 1回は意味上の曖昧性修復に残す
- 同じturn 1 checkpoint `31154565862` から同じturn 2を再実行する

## turn 2 合格条件

前のauditと同じく、以下すべてを満たすまでturn 3へ進まない。

1. app turnがaccepted
2. 誤ったhard deadlineがweekly graphに残らない
3. owner contextにgoal_event=`共通テスト模試`
4. owner contextにconcern=`数学`
5. concern provenanceがcurrent turnにgroundされる
