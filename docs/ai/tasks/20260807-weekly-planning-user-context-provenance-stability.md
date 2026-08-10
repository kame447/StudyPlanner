# Weekly Planning: durable user context provenance stability

Status: active
Date: 2026-08-07
Trigger run: `31170133852`
Last good checkpoint before turn 3: `31168266197`

## 発見した問題

turn 3 ではcross-turn task bindingとdaily recurrenceは正しくなった。

- active task数: 2のまま
- active component数: 1のまま
- 夏休み課題の0.5 targetは既存taskへ追加
- 模試勉強の2h/day targetは既存taskへ追加
- recurrence=dailyも追加

しかしowner-level contextの既存record

```text
kind=concern
label=数学
value=結構まずい
sourceTurn=turn 2
sourceText=数学が結構まずい
```

がturn 3で

```text
value=結構まずい
sourceTurn=turn 3
sourceText=数学を中心に
```

へ更新された。

turn 3のcurrent userTextは「数学を中心に」としか述べておらず、「結構まずい」という懸念内容を再度述べていない。AIがstored userPlanningContextからvalueだけを再利用し、現在のentity mentionを新しい証拠として付け替えた状態である。

## 7視点監査

### 1. provenance meaning

owner contextは「何を覚えているか」だけでなく「どの発話から得た情報か」が重要である。

現在turnが既存entityへ言及しただけで、過去のconcern内容のsourceTurn/sourceTextを現在turnへ移してはならない。

履歴としては、同じconcernが新しい情報として更新された時だけprovenanceを進める。

### 2. semantic delta contract

`userPlanningContext` はnormalizerへの参照contextであり、current semantic deltaへコピーするaccepted factではない。

既存concernと完全同一の

```text
kind + entity label + value
```

を再出力しても、owner stateとして新情報は増えていない。

したがって同一concernはcurrent userTextに同じ内容が再度現れた場合でも、semantic deltaから除去して既存recordを維持してよい。再確認だけで履歴を書き換える必要はない。

### 3. goal_eventとの違い

`goal_event` は相対日付を含み得る。

例えば別の日に再び `2週間後に試験` と述べた場合、同じ `dateExpression=custom:2週間後` でもresolvedDateは変わり得る。

よってgoal_eventを「kind/label/dateExpressionが同じ」という理由だけで常に重複除去してはならない。現行どおり、current sourceTextがgroundされている再提示はsemantic handlingへ残す。

この特殊性はconcernにはない。

### 4. deterministic normalization boundary

concernのcopy判定はraw textの意味再解釈を行わず、stored structured contextとのexact comparisonだけで行う。

```text
stored.kind == concern
stored.label == entity.label
stored.value == signal.value
```

なら、同一owner factの再コピーとしてsignalを除去する。

valueが変わっていれば除去しない。その場合は通常のsourceText groundingを通し、current turnの新しいconcernとして扱う。

### 5. storage lifecycle

同一concernの再コピーを除去することで、`UserPlanningContextSpace` のupsertが実行されず、元の

- sourceConversationId
- sourceTurnId
- sourceText
- recordedAt

を保持できる。

本当にvalueが変わったconcernだけが同一label recordを更新する。

### 6. fail-closed / regression

保存済みconcernと一致しない新しいsignalはalgorithmicに削除しない。

- 新value + grounded sourceText → 通常受理
- 新value + ungrounded sourceText → evidence validatorでreject/AI repair
- malformed signal → schema validatorでreject

ラベル近似・keyword・感情語辞書は使わない。

### 7. turn 3 acceptance criteria

同じturn 2 checkpoint `31168266197` から同じturn 3を再実行する。

合格には以下すべて必要。

1. active task数=2
2. active component数=1
3. 夏休み課題0.5 workloadが既存taskへ追加
4. 模試勉強2h/day workloadが既存taskへ追加
5. matching daily recurrenceあり
6. goal_event=共通テスト模試はturn 2 provenanceを保持
7. concern=数学 / 結構まずいもturn 2 provenanceを保持
8. turn 3がfailureなし

満たさない場合はturn 4へ進まない。
