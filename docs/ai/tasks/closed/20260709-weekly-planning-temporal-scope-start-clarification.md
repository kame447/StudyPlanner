# 週間計画の temporal scope と開始地点 clarification を分離する

本mdの範囲外へ進まない。git add / commit / push はしない。production code は本タスク実装時のみ変更する。

## 背景

週間計画の期間指定で、次の意味論を扱いたい。

- 「今日から一週間の計画を立てたい」
  - 開始日は今日。
  - 期間は7 calendar days。
  - clarification 不要。
- 「一週間の計画を立てたい」
  - 明示的な将来期間や開始地点がない。
  - 現在日時を開始地点として採用する。
  - 今日のすでに過ぎた時間帯は配置対象にしない。
  - 期間は7 calendar days。
  - clarification 不要。
- 「来週の計画を立てたい」
  - 「来週」という temporal scope は保持する。
  - その scope 内のどの日から開始するかが未指定なら clarification する。
  - 例: 「来週のどの日から計画を始めますか」
  - 応答「水曜日から」は、保持済みの来週 scope 内の水曜日として解釈する。
- 「夏休みの一週間で計画を立てたい」
  - 現在とは別の将来期間を示す scope がある。
  - 開始地点未指定を理由に現在日時へ fallback しない。

基本原則は、**将来期間を示す別の temporal scope が存在せず、開始地点だけが欠落している場合に限り、現在日時を既定値として採用する**ことである。

単純に「開始日がなければ常に今日から」にしない。単純なキーワード guard だけにも寄せない。

## 現状調査結果

- `PlanningRange` は `startDateTime` / `endDateTime` / `sourceText` / `confidence` を持つ確定 range 型である。`confidence: 'missing'` はあるが、「来週 scope は保持済み、開始日は未確定」の構造はない。
- `PlanningIntakeState.range` は存在するが、`confirmedSlotsFromState` は `state.range` があれば `planning_range` 確定として扱う。未確定 scope をそのまま `range` に入れると、確定済み扱いになりやすい。
- `WeeklyPlanningIntakeContext` は `selectedDate` と `planningDayCount` のみを持つ。現在時刻または現在日時は渡されていない。
- `WeeklyPlanningIntakePipelineInput` は `planningStartDate` と `planningDayCount` を持ち、scheduler へもこの値を直接渡す。`state.range` は dry-run scheduling の start date には使われていない。
- `parseSetPlanningRangeCommand` は現状、「今日のN時から土日の終わりまで」の weekend range だけを deterministic に解釈する。「今日から一週間」「一週間」「来週」「7月15日から一週間」「夏休みの一週間」は扱っていない。
- AI interpreter の schema には `set_planning_range` があるが、現状の deterministic parser / reducer / pipeline には temporal scope と開始地点未確定を分離する contract がない。
- dialogue manager の `PlanningIntakeMissing` / question plan には temporal start を表す missing key がない。質問文 fallback にも「来週 scope 内の開始曜日だけを聞く」slot はない。
- scheduler 側の `WeeklyDraftCandidateSessionPolicy.firstDayStartTime` と `LifeConstraint.studyAvailableStart` は、初日の配置下限時刻を表現できる。ただし、現在日時から `firstDayStartTime` を組み立てる経路はない。
- `createWeeklyDraftCandidatesFromRemainingWorkItems` の `planningDayCount` は planning window の calendar day 数である。`planningDayCount === 7` の場合、通常配置は先頭6日、7日目は予備日になる。これは「期間が7日」の意味と「通常配置対象が6日」の scheduling policy を分けて扱う必要がある。
- legacy/simple path には `/来週/` なら `selectedDate + 7` を baseDate にする処理があるが、これは新 intake path の temporal clarification には再利用しない。scope 保持や開始日未確定を扱わないためである。

## 既存状態・型・変数の再利用可否

- `PlanningRange`
  - 意味: 確定済みの計画 range。
  - 日付粒度: `startDateTime` / `endDateTime` は datetime string。
  - 未確定 scope: 直接は保持できない。
  - 所有層: intake state / command。
  - 判定: 確定 range の保存先として再利用可。未確定 scope の保存先として単独利用は不可。
- `PlanningRange.confidence`
  - 意味: explicit / inferred / missing の信頼度。
  - 未確定 scope: `missing` だけでは、scope kind、scope start/end、欠落している値が開始日なのか終了日なのかを表せない。
  - 判定: 補助情報としては使えるが、clarification state の代替にはしない。
- `SetPlanningRangeCommand`
  - 意味: range を確定する command。
  - contract: `range: PlanningRange` 必須。
  - 判定: 「今日から一週間」「来週の水曜日から一週間」「7月15日から一週間」のように開始日が確定できる場合に使う。未確定 scope を確定 command として流さない。
- `PlanningIntakeMissing`
  - 意味: dialogue が質問する不足 slot。
  - 現状: temporal start 欠落を表す値がない。
  - 判定: 既存 mechanism は再利用候補。ただし missing key 追加または clarification context 拡張が必要。
- `WeeklyPlanningDialogueDecision.questionPlan`
  - 意味: 何を質問するかの deterministic plan。
  - 現状: `targetSlot` は string なので temporal start 用 slot を載せる余地はあるが、型上の missing がない。
  - 判定: UI と renderer を広げずに既存 clarification 経路へ流す候補。
- `WeeklyDraftCandidateSessionPolicy.firstDayStartTime`
  - 意味: planningStartDate 初日の dayStart override。
  - 日付粒度: 時刻のみ。
  - 判定: 「一週間の計画を立てたい」で現在日時から初日の下限時刻を渡す先として再利用可。現在日時そのものは別途 pipeline 境界で必要。
- `LifeConstraint.studyAvailableStart`
  - 意味: 日付指定または全日適用の学習開始下限。
  - 判定: ユーザーが生活条件として明示した下限には再利用可。今回の「現在時刻以降」は session policy の firstDayStartTime がより直截。
- `planningStartDate` / `planningDayCount`
  - 意味: scheduler input の確定済み開始日と calendar day 数。
  - 判定: 最終的に解決済み start date と dayCount を渡す既存経路として再利用可。未解決 scope は渡さない。

## 現在のデータフロー

1. caller が `runWeeklyPlanningIntakePipeline` に `planningStartDate` と `planningDayCount` を渡す。
2. pipeline は `planningStartDate` を `WeeklyPlanningIntakeContext.selectedDate` として intake reducer に渡す。
3. reducer は deterministic setup command として `parseSetPlanningRangeCommand` を実行する。
4. 現状の parser が認識できる planning range は「今日のN時から土日の終わりまで」だけである。
5. `set_planning_range` があれば reducer は `state.range` に保存し、missing slot を追加する。
6. pipeline は `state` から draft request を作る。
7. scheduler は `state.range` ではなく pipeline input の `planningStartDate` / `planningDayCount` / `sessionPolicy` で候補を生成する。
8. dialogue manager は `state.missing`、draft request、dry-run diagnostics から質問や preview decision を作る。

このため、現在は「発話上の temporal scope」と「scheduler に渡す確定済み planningStartDate」が分離されていない。分離されていないというより、scope 側が model 上に存在していない。

## 問題の根本原因

- 確定済み range と未確定 temporal scope の区別が型と state にない。
- `set_planning_range` は確定 range command なので、「来週 scope は分かったが開始日だけ不明」という draft 状態を安全に表現できない。
- pipeline scheduling は `state.range` を参照せず、外から来た `planningStartDate` を常に使うため、発話の temporal scope が scheduling start に反映される保証がない。
- clarification 経路には temporal start 欠落を表す slot がないため、「来週のどの日から始めるか」を聞き、次 turn の「水曜日から」と結合する契約がない。
- 現在日時が pipeline context にないため、「一週間の計画」で初日を現在時刻以降にするための deterministic input が不足している。

## 実装対象

必要最小限で、次を実装する。

1. temporal parsing の責任を整理する。
   - parser は current turn の自然文から temporal scope、明示 start、duration を抽出する。
   - parser 以外の reducer / validator / scheduler は自然文を再解析しない。
2. 開始日が確定できる場合だけ `set_planning_range` または既存の確定 range 経路へ流す。
   - 「今日から一週間」
   - 「来週の水曜日から一週間」
   - 「7月15日から一週間」
3. 開始日が未確定だが将来 temporal scope がある場合は hard apply せず、既存 clarification 経路へ流す。
   - 「来週の計画を立てたい」
   - 「夏休みの一週間で計画を立てたい」
4. 将来 temporal scope がなく、期間だけが指定されている場合は現在日時を既定値として採用する。
   - 「一週間の計画を立てたい」
5. `firstDayStartTime` へ現在時刻由来の下限を渡せる最小経路を作る。
   - 既存 `sessionPolicy.firstDayStartTime` を優先して再利用する。
   - pipeline input へ現在日時または current time provider を足す必要がある場合は、task 内で最小変更に留める。
6. clarification の応答「月曜から」「水曜日から」を、保持済み scope 内の日付に解決する。
   - 解決できた時点で確定 range に変換する。
   - 解決できない場合は再度 clarification に倒す。

## 対象外

- golden case の入力文や期待値の変更。
- Worker routing、model policy、quota、API client。
- renderer 全体の再設計。
- UI、CSS、save / approval 導線。
- scheduler の配置アルゴリズム大改造。
- 7日目予備日 policy の変更。
- legacy/simple weekly path の挙動変更。ただし regression 防止のため参照は可。
- 時系列文脈全体の resolver 実装。
- 学校カレンダーや実際の夏休み期間 DB の導入。
- 「夏休み」の具体日付を推測で決めること。
- AI prompt だけで挙動を直すこと。

## 期待する意味論

- `duration: 一週間` は 7 calendar days を意味する。
- `planningDayCount = 7` は startDate を含む7日間の planning window を意味する。
- scheduler の通常配置が6日、7日目が予備日になる既存 policy は維持する。
- 「今日から一週間」は `planningStartDate = today`、`planningDayCount = 7`。
- 「一週間の計画を立てたい」は、別の将来 scope がないため `planningStartDate = today`、初日は現在時刻以降。
- 「来週の計画を立てたい」は、来週 scope を保持し、開始日未確定として clarification。
- 「来週の水曜日から一週間」は、来週 scope 内の水曜日を開始日として確定。
- 「7月15日から一週間」は、7月15日を開始日として確定。
- 「夏休みの一週間で計画を立てたい」は、現在日時 fallback せず clarification。夏休み scope の具体範囲がない場合は、scope 自体または開始日を聞く。

## clarification の状態遷移

### 来週の計画を立てたい

1. parser が `temporalScope = next_week`、`duration = 7 days`、`start = unresolved` を返す。
2. reducer は確定 range として hard apply しない。
3. dialogue は temporal start missing として「来週のどの日から計画を始めますか」と聞く。
4. pending clarification には `next_week` scope と duration を保持する。
5. ユーザーが「水曜日から」と答える。
6. parser は weekday start を抽出し、pending scope 内の水曜日に解決する。
7. reducer は確定 range を保存し、scheduler へ解決済み start date と dayCount を渡す。

### 一週間の計画を立てたい

1. parser が `duration = 7 days`、`temporalScope = none`、`start = missing` を返す。
2. 将来 temporal scope がないため、現在日時を default start として採用する。
3. `planningStartDate = today`、`firstDayStartTime = current time` 相当を scheduler context に渡す。
4. clarification は不要。

### 夏休みの一週間で計画を立てたい

1. parser が `temporalScope = named_future_period`、`duration = 7 days`、`start = unresolved` を返す。
2. 現在日時 fallback は禁止。
3. scope の実日付が解決不能なら、「夏休みのどの日から始めますか」または「夏休みの期間を教えてください」と聞く。
4. 解決できるまで hard apply しない。

## 責任境界

### parser

- 自然文を読む唯一の層。
- relative date、weekday、duration、temporal scope を抽出する。
- `today`、`tomorrow`、`next_week`、explicit date、named future period などを分類する。
- 「start unresolved」と「start missing but no future scope」を区別する。

### command

- 確定できた planning range だけを `set_planning_range` として表現する。
- 未確定 temporal scope を確定 range command に偽装しない。
- 必要なら、確定 range command とは別の draft / clarification 用 command を最小追加する。

### reducer

- parser / command の構造化結果だけを見て state を更新する。
- 自然文の再解析はしない。
- 未確定 scope は hard apply せず、clarification 待ち状態にする。
- 確定済み start date と duration が揃ったときだけ planning range を確定する。

### dialogue

- 既存 clarification 経路を再利用する。
- temporal start missing の質問を deterministic に組み立てる。
- scope ラベルを保持し、「来週」「夏休み」などを質問文に反映する。
- renderer に事実を補完させない。

### scheduler

- 解決済み `planningStartDate`、`planningDayCount`、`sessionPolicy.firstDayStartTime` を受け取って配置する。
- natural language や temporal scope を解釈しない。
- `planningDayCount = 7` と7日目予備日 policy を維持する。

## 最小変更案の比較

### 案A: `PlanningRange.confidence = 'missing'` を使う

- 追加 field は少ない。
- しかし `state.range` があるだけで planning range 確定扱いになる箇所がある。
- scope kind や unresolved reason を保持できない。
- 判定: 単独採用は避ける。

### 案B: 既存 clarification context を拡張する

- 既存 dialogue 経路を再利用できる。
- 「何を聞くか」と「次 turn の短い回答を何に結合するか」を同じ場所で扱いやすい。
- temporal start 用 missing slot または pending metadata の追加は必要。
- 判定: 最優先候補。

### 案C: planning range command に draft 状態を追加する

- parser から reducer へ structured に渡しやすい。
- 確定 command と未確定 draft command の境界を明確にする必要がある。
- 判定: 案Bだけでは pending scope を保持できない場合の候補。

### 案D: 新しい temporal scope state を追加する

- 表現力は高い。
- state surface が広がり、dialogue / renderer / pipeline へ波及しやすい。
- 判定: 案Bまたは案Cで不足する場合だけ検討する。

## テスト観点

- parser / command unit
  - 「今日から一週間の計画を立てたい」が today start、7 days として確定される。
  - 「一週間の計画を立てたい」が future scope なし、duration 7 days、default-now 対象になる。
  - 「来週の計画を立てたい」が next_week scope、start unresolved になる。
  - 「来週の水曜日から一週間」が next_week scope 内の水曜日 start、7 days として確定される。
  - 「7月15日から一週間」が explicit date start、7 days として確定される。
  - 「夏休みの一週間で計画を立てたい」が named future scope、start unresolved になり、now fallback されない。
- reducer / dialogue
  - 未解決 temporal start は `shouldCreateDraft: false` のまま clarification へ進む。
  - 「来週の計画を立てたい」への質問が「来週」の scope を保持する。
  - 次 turn「水曜日から」が保持済みの来週 scope と結合される。
- pipeline / scheduler
  - 解決済み range が scheduler input の `planningStartDate` / `planningDayCount` に反映される。
  - 「一週間の計画を立てたい」は初日の過去時間帯を避けるため `firstDayStartTime` が効く。
  - `planningDayCount = 7` は startDate を含む7 calendar days のまま。
  - 既存の7日目予備日挙動は変わらない。
- regression
  - 既存の「今日の19時から土日の終わりまで」range parser が壊れない。
  - legacy/simple weekly tests を不用意に変更しない。
  - renderer deterministic context task の「来週」ラベル保持と矛盾しない。

## 受け入れ条件

- 「今日から一週間の計画を立てたい」は clarification なしで、今日を開始日とする7日間の planning range になる。
- 「一週間の計画を立てたい」は clarification なしで、現在日時を開始地点として採用し、初日の過去時間帯へ配置しない。
- 「来週の計画を立てたい」は現在日時へ fallback せず、来週 scope を保持したまま開始日 clarification になる。
- 「来週の水曜日から一週間」は clarification なしで、来週 scope 内の水曜日から7日間になる。
- 「7月15日から一週間」は clarification なしで、7月15日から7日間になる。
- 「夏休みの一週間で計画を立てたい」は現在日時へ fallback せず、開始日または期間 scope の clarification になる。
- 「来週の計画を立てたい」からの clarification 応答「水曜日から」が、保持済みの来週 scope 内の水曜日として解決される。
- parser 以外の層で自然文再解析を増やさない。
- scheduler は解決済み planning context だけを受け取り、temporal scope の解釈を持たない。
- golden case、Worker routing、model policy、quota、renderer 全体、UI、save / approval は変更しない。

## 検証(Node 22)

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/intake
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/scheduling/weeklyDraftCandidateGenerator.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```

## Codexへの実装指示

1. 最初に本md全体と `docs/ai/codex-task-guide.md` を読む。
2. 実装前に、現状コードが本mdの調査結果と食い違っていないか確認する。
3. 食い違いが大きい場合は実装せず報告する。
4. 既存構造で表現可能なら、新しい state / field を増やさない。
5. `PlanningRange` を未確定 scope の隠し場所にしない。確定 range と pending clarification を分ける。
6. parser 以外の層に自然文再解析を追加しない。
7. `shouldSavePlan: false` を維持する。
8. task 範囲外の改善へ広げない。
