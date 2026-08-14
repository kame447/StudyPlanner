# weeklyPlanning current contract status

Status: canonical / Stable V5 sole runtime + conversation-quality re-verification
Updated: 2026-08-14

- [current contract v5](weekly-planning-current-contract-v5.md)
- [runtime contract](weekly-planning-stable-v5-runtime-trial-contract.md)
- [main roadmap](strategy/weekly-planning-roadmap.md)
- [semantic roadmap](strategy/weekly-planning-semantic-v5-roadmap.md)
- [test philosophy](testing/weekly-planning-test-philosophy.md)
- [current conversation-quality / Luna task](tasks/20260814-weekly-planning-conversation-quality-luna-audit.md)
- [completed SOLID refactor roadmap](strategy/20260814-solid-refactor-roadmap.md)
- [completed seven-perspective audit](audits/20260814-solid-refactor-seven-audit.md)

## 1. 現在位置

Stable V5は唯一のproduction週間計画runtimeである。

完了済みの主要段階:

- PR #109: Stable V5主要経路をmainへ固定
- PR #112: productionから到達不能なlegacy interpreter / parser / runtime / semantic experimentを削除
- PR #113: semantic module責務を整理
- PR #120: human grounding / repair、scheduler human-scale policy、real API hardening、semantic orchestration監査、legacy behavior-aware execution cluster隔離を完了しmainへmerge
- PR #127: audited Browser Regression suiteを統合しmainへmerge
- PR #129: file-by-file SOLID hardening、MD棚卸し、browser regression監査を完了しmainへmerge

PR #129はDayView、BookshelfView、AdminViews、MonthEventDialog、MonthViewを含む残りfile-by-file SOLID hardening、MD棚卸し、七視点敵対的監査を完了しmainへmerge済みである。

現在は第2PR `agent/weekly-conversation-quality-luna-audit` 1本で、過去の会話品質taskとIssueを現コードへ対応付け、Stable V5をLunaで一対話ずつ再観測する。Issue #118のcompleted duration clarificationに加え、Issue #115のfresh-session raw-text regex入口を小さいstructured AI routerへ置換する。prompt複雑性、historical heuristic、最終previewも同じPRで監査し、Stable V5の決定論的readiness / scheduler / preview / approval / save境界は変更しない。

## 2. Stable V5 production baseline

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

残すcompatibility layerは、保存data migration、approval / owner migration、trace/export read compatibility、current observation/test supportなど、既存data/read contractのためのものに限定する。runtime selectorとして扱わない。

## 3. AI / deterministic責務

AI:

- raw user text / conversation contextの意味理解
- task / component / quantity role
- date / weekday / time period / clock intent
- correction / short contextual answer
- authorization intent
- structured semantic candidates

Deterministic core:

- schema / evidence / reference validation
- formal binding / canonical IDs
- Fact Graph lifecycle
- revision / idempotency
- clarification / confirmation requirement
- question priority / progression
- readiness
- scheduler / placement safety
- preview freshness
- approval / save
- persistence / recovery / safety

raw Japaneseをregex / keyword / dictionary / legacy parserで再解釈してsemantic truthにしない。provider / validation / repair failureからlegacy parserへfallbackしない。renderer textからmachine stateを逆推定しない。

## 4. 現在までに確立した主要能力

- selectedDateと実際の発話日時の分離
- request-time not-before / today past-time hard boundary
- weekStartsOn / `来週` grounding
- active-only corrected Fact projection
- proposal acceptance / rejection grounding
- repair agenda / local self-repair
- human-scale effort questions
- page/problem per-unit effort
- vocabulary total/session effortとsession分割
- preview保持 / session chunking / daily load distribution
- tiny-tail抑制 / long free segment優先
- task relation ordering / cycle blocking
- timetable / existing-plan buffer
- reserve / review policy
- owner-scoped actual-derived effort calibration
- canonical weekday / planning-window / clock validation
- focused machine-pending semantic routes
- preview / approval runtime ownershipのconversation isolation
- Stable V5 execution clusterからlegacy behavior-aware execution edgeの隔離

## 5. 現在の会話品質監査

2026-08-07/10の会話品質task群は、現コードに実装と回帰が存在するものを未実装扱いせず、Luna再観測scenarioへ変換する。各turnでsemantic response、validation/repair、formal binding、Fact Graph、dialogue、renderer、preview、traceを確認し、明確な失敗があれば次へ進まない。

モデル更新後もAI/deterministic責務境界は維持する。promptは意味・安全contract、schema重複、historical scaffolding、意味不変normalizationに分類し、Luna ablationで退行がないものだけを削減候補とする。

## 6. Current verification

PR #129のmerge前最終HEADでは次を確認済み。

- normal CI success
  - npm ci
  - TypeScript checks
  - Vitest
  - production build
- PR diff check
- Browser Regression success: 80 / 80 passed

PR #129はready化後にsquash mergeされ、main merge commitは`be0c483d779be315f10ccf3f34adb9c7420e9631`である。

第2PR開始時の代表prompt実測はgeneric system 5,002 bytes、provider schema 11,333 bytes、generic request 17,351 bytes、focused authorization 1,202 bytes、focused contextual answer 2,263 bytesで、現budget内である。会話品質のpass判定は今後の逐次・通し実API artifactと最終HEADのCI結果で行う。

テストを「追加した」ことと「実行してgreenだった」ことを区別する。

## 7. 既知の残Issue / 別scope

現在PRへ混在させない主な残件:

- Issue #43: request ownershipの残browser evidence
- Issue #45: trace privacy / lifecycle / operational rollout
- Issue #47: personalization / cloud session authority（current-time safety自体は完了）
- Issue #51: cross-tab / cross-device approval uniqueness
- Issue #52: weekly planning UIをgeneric Quick Entry / AI inputから分離
- Issue #89: trace empty-session production / operational verification
- Issue #115: raw-text regex weekly entry routingをAI-owned structured routingへ移行
- Issue #118: 今回の対象。deterministic導出は実装済みで、completed durationを先に確認する会話policyが残る
- Issue #128: saved-preview approval compatibility migration

Issue #52 / #115は今回も独立scopeを維持する。

## 8. 今回の既知残差

- Issue #118 completed-duration clarification
- historical conversation taskのLuna再観測とtask queue closeout
- production heuristicの対象・敵対的回帰
- prompt複雑性とLunaで削減可能なscaffoldingのablation
- 最終HEADの逐次会話、通しpreview、Browser Regression、normal CI
- production buildの既存chunk/code-splitting warningは今回の会話品質scope外

これらは次のfile-by-file phaseで、対象回帰を先に用意できる単位から処理する。

## 9. 次の進行条件

1. stale task・Issue・PRを現コード根拠へ対応付ける
2. historical scenarioをLunaで一対話ずつ再観測する
3. 明確な失敗があれば次turnへ進まず原因層を直して同地点から再実行する
4. Issue #118、heuristic、prompt ablationを対象回帰とfull CIで確認する
5. 最終HEADで通しpreview、Browser Regression、normal CIをgreenにする
6. roadmap、contract、status、task queue、Issueを観測結果と同期する
