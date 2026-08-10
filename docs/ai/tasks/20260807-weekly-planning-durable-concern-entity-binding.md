# Weekly Planning: durable concern の entity-local binding

Status: implementation audit / active
Date: 2026-08-07
Related: `20260807-weekly-planning-goal-event-date-vs-work-deadline.md`

## 実APIで残った問題

run `31166510407` では、次の改善は機能した。

- event occurrence と work deadline の同一evidence二重分類をvalidatorが拒否
- 1回だけのAI repairで誤ったhard deadlineを除去
- `共通テスト模試` をowner-level `goal_event` として保持
- `custom:2週間後` を observedDate=2026-08-07 基準で 2026-08-21 に解決

一方、同じAIは

- component label=`数学`
- component sourceText=`特に数学が結構まずいです。`

まで正しく構造化したにもかかわらず、top-level `userContextFacts` に `concern` を出力しなかった。system promptで「componentとconcernは共存できる」「明示されたdifficulty/weakness/concernを独立確認する」と明記した後も、initial/repairの双方で欠落した。

したがってprompt追記だけを繰り返す方式は採用しない。

## 7視点監査

### 1. 意味表現

「数学が結構まずい」は、現在週のtask構造では `数学` componentに関する状態であり、長期文脈では `数学` に対するconcernである。

この2つは同じ発話根拠を共有してよい。event occurrenceとwork deadlineのような競合conceptではなく、entityとその属性の関係である。

したがって `component=数学` と `concern=数学がまずい` を離れた配列へ重複生成させるより、component自身にAI解釈済みのdurable context signalを付ける方が意味構造に近い。

### 2. AI semantic ownership

後段コードが `sourceText` 内の「まずい」「苦手」「不安」等をregex/keywordで見てconcernを生成することは禁止する。これはraw発話の再解釈になる。

AIがcomponent/taskを作る時点で、同じentityに対して `durableContextSignals` を明示する。

coreは、AIが明示した

- signal.kind=`concern`
- entity.label=`数学`
- signal.value/sourceText

を機械的にowner context recordへ写像するだけとする。意味判定は行わない。

### 3. schema / omission resistance

provider向けJSON Schemaでは、各task/componentに `durableContextSignals` を必須arrayとして持たせる。該当なしなら空配列。

これにより、modelはtask/componentを生成するたびに同じ局所文脈上で「長期保持すべきconcernがあるか」を判断する。top-level配列へ後から再探索する方式より omission risk を下げる。

pre-migrationの既存fixture/checkpointは内部validatorでfield省略を空配列として扱い、互換性を維持する。

### 4. storage lifecycle

保存先は既存のowner-scoped `UserPlanningContextSpace` を継続利用する。

- weekly graphへdurable concern recordを混ぜない
- turn実行中はstage
- application turn正式commit時のみfinalize
- stale/failed/rejected turnはdiscard
- graph finalize失敗時はcontextもrollback

entity-local signalはsemantic turn document上の一時表現であり、永続化時にはstable owner context recordへ変換する。

### 5. cross-conversation reuse

保存済みconcernは次回以降の `publicStateSummary.userPlanningContext` にbounded summaryとして渡す。

ただし、過去concernを現在週のhard constraintへ自動変換しない。AIは提案・確認・優先順位判断の文脈として使う。

同じconcernが再度明示された場合はowner context store側で同一identityを更新し、source provenanceとrecordedAtを新しいturnへ更新する。

### 6. 汎化

特定の「数学」「まずい」専用実装は禁止する。

同じ構造で、例えば次を扱う。

- 英語の長文が苦手
- 研究の分析が遅れていて不安
- この教材の復習がかなり弱い
- 家事の片付けが溜まっている

componentに紐づく場合はcomponent signal、task全体に紐づく場合はtask signalを使う。

初期signal kindは `concern` のみに限定し、preference/skill-level等を推測で広げない。

### 7. 回帰・観測性

最低限以下を検証する。

- component-local concern → owner context concernへ変換
- task-local concern → owner context concernへ変換
- signalなし → context生成なし
- signal sourceTextはcurrent userTextにgroundされる
- signal localIdはresponse全体で一意
- old fixtureでsignal field省略 → 空配列として互換
- provider JSON Schemaではtask/componentのsignal arrayを必須
- top-level goal_eventとentity-local concernを同一turnで両方保存可能
- owner分離、stage/finalize/discard/rollbackを維持
- raw text keyword parserを追加しない

## 採用設計

### Semantic durable context signal

```ts
interface SemanticDurableContextSignalV5 {
  localId: string;
  kind: 'concern';
  value: string | null;
  sourceText: string;
}
```

`SemanticTaskV5` と `SemanticStudyComponentV5` に

```ts
durableContextSignals: SemanticDurableContextSignalV5[]
```

を持たせる。

provider schemaではrequired、内部TypeScriptではmigration期間のみoptionalを許可する。

### owner contextへの変換

component signal:

```text
component.label + signal(kind/value/sourceText)
→ UserPlanningContextSemanticFactV1(kind=concern, label=component.label, ...)
```

task signal:

```text
task.title + signal(...)
→ owner concern
```

この変換でraw userTextを読まない。

既存top-level `userContextFacts` は、task/componentへ自然にattachできない `goal_event` 等のcross-cutting owner context用として維持する。top-level concernも互換上は受理できるが、matching entityがあるconcernはentity-local signalを優先する。

## Turn 2 合格条件

同じturn 1 checkpoint `31154565862` から、同じturn 2発話を再実行する。

合格には最低限すべて必要。

1. weekly graphに誤った `hard deadline=2週間後` がない
2. owner contextに `goal_event=共通テスト模試` がある
3. owner contextに `concern=数学` がある
4. concernのsource provenanceがcurrent turnにgroundされている
5. conversation/application responseが失敗していない

満たさない場合はturn 3へ進まない。
