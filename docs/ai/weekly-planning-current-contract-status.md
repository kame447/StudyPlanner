# weeklyPlanning current contract status

Status: canonical / PR #120 real-API hardening and selective orchestration audit
Updated: 2026-08-12

- [current contract v5](weekly-planning-current-contract-v5.md)
- [runtime contract](weekly-planning-stable-v5-runtime-trial-contract.md)
- [main roadmap](strategy/weekly-planning-roadmap.md)
- [semantic roadmap](strategy/weekly-planning-semantic-v5-roadmap.md)
- [test philosophy](testing/weekly-planning-test-philosophy.md)
- [current execution task](tasks/20260812-weekly-planning-legacy-concept-migration-and-real-api-audit.md)

## 1. 現在位置

PR #109でStable V5主要経路をmainへ固定し、PR #112でproductionから到達不能なlegacy interpreter/parser/runtime/semantic experimentを削除した。PR #113でsemantic module責務を整理した。

現在はPR #120 `agent/weekly-planning-human-grounding-repair`で次を同時に最終化している。

- human grounding / repair dialogue
- legacy実装思想の選別移植
- scheduler human-scale policy
- real API output varianceへのformal contract強化
- semantic prompt / orchestration監査
- roadmap / contract / task MD整理

旧`Phase 4 behavior-preserving refactor`表記はcurrent phaseではない。

## 2. Stable V5 production baseline

Stable V5が唯一のproduction週間計画runtimeである。

```text
user utterance
→ machine-state semantic routing
   ├─ focused authorization AI
   ├─ focused contextual-answer AI
   └─ generic open-ended semantic AI
→ validation / optional one-shot AI repair
→ formal binding / canonical commit
→ Fact Graph V5
→ readiness / scheduler / dialogue
→ AI renderer
→ preview / approval / save
```

削除済みlegacy runtimeへ戻すproduction pathはない。

残す互換層:

- 保存data migration decoder
- approval / owner migration
- trace/export read compatibility
- current observation checkpoint helper
- repository / test support

これらはruntime selectorではない。

## 3. AI / deterministic責務

- raw user text、会話文脈、訂正、quantity role、曜日・日付・時刻、authorization intentの意味理解はAI。
- focused routeでも意味理解はAI。
- deterministic routerはmachine stateからsemantic責務を選ぶだけ。
- validator / formal binding / Fact Graph / revision / readiness / question priority / scheduler / preview / approval / saveはdeterministic core。
- provider / validation failureからraw Japanese parserへfallbackしない。
- renderer文面からpending targetやsemantic factを逆推定しない。

## 4. PR #120で現在までに確認済みの主要改善

- selectedDateと発話日時の分離
- weekStartsOn / `来週` grounding
- today past-time hard boundary
- active-only corrected fact projection
- proposal acceptance / rejection grounding
- repair agenda / local self-repair
- human-scale effort questions
- page/problem per-unit effort
- vocabulary total/session effort
- vocabulary <=100語/session分割
- split sessionのpreview保持
- session chunking / daily load distribution
- tiny-tail抑制
- heavy taskのlong free segment優先
- task relation ordering / cycle blocking
- timetable / existing-plan buffer
- reserve / review policy
- actual-derived effort calibration
- canonical weekday / planning-window / clock validation
- representation-only repair preservation
- machine-pending effort / quantity-role focused semantic

## 5. Prompt / orchestration current status

real API実測:

- generic initial request: 23,014 bytes
- generic system prompt: 10,404 bytes / 53 lines
- focused導入前のmachine-pending短答`8分くらいです。`: 25,239 bytes generic request

system prompt 53行のうち38行に`never` / `must` / `only` / `do not`が含まれる。全てが不要な制約ではないが、instruction densityは高い。

現在の判断:

- generic semanticを今すぐ全面分割はしない。
- genericへalways-on規則をこれ以上安易に追加しない。
- machine-stateでtargetが確定した継続turnはfocused routeを優先する。
- representation contractはschema / canonicalizer / validatorを優先する。
- AI repair対象がfield-localならfull-document repairではなくfield-scoped repairを検討する。
- validator errorごとにsystem prompt + validator + repair promptを三重追加しない。

CI prompt budget gate:

- generic system <= 11,000 bytes
- representative generic request <= 24,000 bytes
- focused authorization <= 2,500 bytes
- focused contextual <= 4,000 bytes
- focused < generic / 4

empty Graphでは約908 bytesを占めていたcorrectionContractをAIへ渡さない。active correction targetがあるturnだけ送る。

## 6. Real API audit status

逐次real APIでは一度、次の3 turnでpreviewまで完走済み。

1. 8/17–8/23、英単語220語、数学40問、火曜18–20除外
2. 数学のeffort回答: 8分
3. 英単語のsession effort回答: 30分

その時点のpreviewは14候補まで生成された。

その後の通しreal APIでsemantic output varianceを追加検出したため、単なる成功runを完了判定には使っていない。

追加で修正・回帰化したもの:

- weekday canonical token / resolver mismatch
- pending短答のgeneric replay問題
- exact clockのcustom namedTimePeriod escape
- non-ISO absolute planning window
- bare weekday token
- destructive targeted repair

最終HEADで逐次real APIと通しreal APIを再実行する必要がある。

## 7. Current verification

直近の各実装batchはfull CIでgreenへ戻してから次へ進めている。

2026-08-12時点でprompt budget gate、empty-Graph correction prompt削減、semantic roadmap同期までtypecheck / full Vitest / production build / diff check greenを確認済み。

ただしPR #120全体のfinal gateはまだ未完了である。

## 8. 残作業

1. current status / roadmap / semantic roadmapの最終同期確認
2. 最終HEADでreal API初期turn再計測
3. 最終HEADで逐次real API conversation
4. 最終HEADで通しreal API conversation
5. prompt / orchestration最終監査
6. 7視点敵対的監査
7. production heuristic inventory確定
8. PR body / task status同期
9. final full CI

新しい実API不具合を見つけた場合はそのturnで停止し、修正→回帰→full CI→再検証する。

## 9. オーケストレーション次候補

優先候補:

- pending `work_breakdown` focused semantic
- planningWindow / weekday / clockのfield-scoped repair

初回自由入力の無条件multi-call fan-outは現時点では採用しない。task、workload、period、availability、modifier、relationを一発話内で統合する必要があるため、分割コストとidentity統合リスクが大きい。

今後generic request budgetを超える変更が必要になった場合、閾値を上げる前にこのオーケストレーション候補を実装・比較する。
