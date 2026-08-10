# Weekly Planning Stable V5 current-turn semantic delta hardening

## 発見した問題

複数ターン会話で、前ターンですでに受理された計画期間をAI normalizerが次ターンのSemanticDocumentへ再コピーした。

今回の例では、前ターンの「来週」がFact Graphに受理済みである一方、次ターンは夏休み課題・模試・数学についてだけ述べていた。それにもかかわらずAIは `planningWindow=next_week` と `sourceText=来週の勉強計画` を再出力したため、current user text grounding検証で正しく拒否された。repairでも同じ再出力を繰り返した。

これは今回の文章だけの問題ではなく、`publicStateSummary` を参照できる全multi-turn入力で、AIが「現在発話の差分」ではなく「現在の計画全体のスナップショット」を返す可能性がある問題である。

## 7視点監査

### 1. 意味解釈責務

現行contractではraw textの意味解釈主体はsingle AI semantic normalizerであり、deterministic codeはvalidator/canonicalizerとして意味を再解釈しない。したがって、既存factと同じだからという理由で後段コードがAI出力を自動削除する方式は採用しない。

修正はAI境界の契約明確化を主とする。

### 2. multi-turn状態

`publicStateSummary` は過去に受理済みの事実をAIへ知らせる文脈であり、再出力を要求するスナップショットではない。

SemanticDocumentは一turnの意味deltaである。現在発話で新規に述べた、変更した、明示的に訂正した、明示的に判断した内容だけを返す。既存factはGraph側に残るため、再出力しなくても失われない。

### 3. planning windowと他factの一貫性

今回だけ `planningWindow` を特別扱いして消す修正にはしない。

planningWindow、task、component、workload、effort、temporal constraint、recurrence、availability、relationなど、すべて同じcurrent-turn delta原則に従う。

現在発話が計画全体の期間を新しく述べたり変更したりしていない場合、既存planning windowがpublicStateSummaryに存在していても `planningWindow: null` とする。

### 4. groundingとfail-closed

`sourceText` がcurrent user textに根拠を持つという既存validationは正しいため緩めない。

過去発話を根拠としてcurrent SemanticDocumentを通すことも認めない。これを許すと、過去状態の無意識な再コピー、古い条件の復活、訂正前factの再導入を検知できなくなる。

### 5. repair経路

現行repairは「complete corrected document」を要求しており、モデルが「complete plan snapshot」と誤読する余地がある。

repairでは、completeとはJSON Schemaの必須top-level keyをすべて返す意味であり、accepted stateを再掲する意味ではないことを明示する。

`not-grounded-in-current-user-text` の場合は、過去からコピーしたfactを削除し、optional single factであればnull、collection factであれば該当要素を除外する。代替sourceTextを捏造しない。

### 6. 対話・readinessへの影響

現在発話でtaskだけが追加され、量や所要時間がない場合でも、そのtask自体は受理してreadinessが次の確認を選べるべきである。

既存planning windowを再出力しないことによって、前ターンで確定した期間がGraphから消えてはいけない。canonicalizerはdeltaとして既存Graphへ追加適用する現行契約を維持する。

### 7. 回帰・将来拡張

特定の「来週」「夏休み課題」「共通テスト模試」をprompt例としてハードコードしない。

テストでは、publicStateSummaryに既存planning windowがあり、current user textが別taskだけを述べる一般的なmulti-turnケースで、base/repair contractがcurrent-turn deltaを要求していることを固定する。

実API再試験は同一の成功checkpointから同一の自然発話を再送し、モデルが `planningWindow:null` または少なくともcurrent textに根拠のない既存windowを再出力しないことを確認する。

## 修正方針

AI normalizerのsystem instructionへ、次を一般契約として追加する。

- SemanticDocument is a delta for current userText, not a snapshot of the accepted plan.
- publicStateSummary is read-only context/reference. Do not copy accepted facts merely because they are present there.
- Emit a fact only when current userText newly states, changes, corrects, or explicitly decides it.
- If current userText does not state/change the plan-wide period, return `planningWindow:null`, even when a planning window already exists in publicStateSummary.
- `update_plan` / `discuss` does not require restating existing planningWindow or tasks.

repair instructionでも同じdelta原則を明示し、`complete corrected document` がschema completenessを意味することを明確化する。

## 今回変更しないもの

validatorのgrounding規則は変更しない。
canonicalizerにstale-fact自動削除を追加しない。
Fact Graph lifecycleを変更しない。
今回の高校生シナリオ専用分岐を作らない。
模試日をdeadlineとして扱うことの妥当性は、このnormalization failureを解消した後の実際の受理結果を見て別問題として評価する。

## 検証

normalizer単体のprompt契約testを追加する。
既存normalizer / pipeline / multi-turn testを実行する。
型検査を実行する。
その後、turn 1成功run `31154565862` のcheckpointからturn 2を同一発話で再実行する。

実API出力で別の意味上の問題が見つかった場合、会話を先へ進めず改めて7視点監査する。
