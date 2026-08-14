# weeklyPlanning current contract status

Status: canonical / Stable V5 sole runtime + conversation-quality re-verification
Updated: 2026-08-14

- [current contract v5](weekly-planning-current-contract-v5.md)
- [runtime contract](weekly-planning-stable-v5-runtime-trial-contract.md)
- [main roadmap](strategy/weekly-planning-roadmap.md)
- [semantic roadmap](strategy/weekly-planning-semantic-v5-roadmap.md)
- [test philosophy](testing/weekly-planning-test-philosophy.md)
- [current conversation-quality task](tasks/20260814-weekly-planning-conversation-quality-reverification.md)
- [completed SOLID refactor roadmap](strategy/20260814-solid-refactor-roadmap.md)
- [completed SOLID loop log](tasks/20260814-solid-file-by-file-loop-log.md)
- [SOLID seven-perspective audit](audits/20260814-solid-refactor-seven-audit.md)

## 1. 現在位置

Stable V5は唯一のproduction週間計画runtimeである。

完了済みの主要段階:

- PR #109: Stable V5主要経路をmainへ固定
- PR #112: productionから到達不能なlegacy interpreter / parser / runtime / semantic experimentを削除
- PR #113: semantic module責務を整理
- PR #120: human grounding / repair、scheduler human-scale policy、real API hardening、semantic orchestration監査、legacy behavior-aware execution cluster隔離を完了しmainへmerge
- PR #127: audited Browser Regression suiteを統合しmainへmerge
- PR #129: file-by-file SOLID hardening、MD棚卸し、browser regression監査を完了しmainへmerge

現在は`agent/weekly-planning-conversation-quality`で、過去PR・Issueとcurrent mainを突き合わせ、実API対話を一turnずつ再検証している。

最初の確定問題はIssue #115のfresh-session入口regexである。raw textの意味判定を小さいstructured AI routerへ移し、Stable V5の決定論的readiness / scheduler / preview / approval / save境界は変更しない。

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

## 5. 現在の構造監査

PR #129のfile-by-file refactorでは、pure domain projection、collection normalization、presentation、interaction flowを変更理由ごとに抽出する一方、凝集している小規模componentはno-changeとする。

七視点監査で確定修正した主項目:

- `DailyMaterialShelf`のmissing-subject fallback metadata ordering regression
- day-material extractionのdirect component regression不足
- `ReportView`のunused required propsとApp caller plumbing
- Browser Regressionのisolated Playwright runner更新
- stale documentation index / closed task duplicate

詳細は`audits/20260814-solid-refactor-seven-audit.md`を正とする。

## 6. Current verification

PR #129のpre-final hardening head `f8eea8348ecbc456046efd3915aa12af3b720e38`では次を確認済み。

- normal CI success
  - npm ci
  - TypeScript checks
  - Vitest
  - production build
  - PR diff check
- Browser Regression success: 80 / 80 passed

その後、Playwright runner更新、ReportView dead contract削除、MD hygiene修正を追加したため、post-audit HEADでnormal CIとBrowser Regressionを再実行して両方greenにすることがPR #129の最終gateである。

テストを「追加した」ことと「実行してgreenだった」ことを区別する。

## 7. 既知の残Issue / 別scope

PR #129へ混在させない主な残件:

- Issue #43: request ownershipの残browser evidence
- Issue #45: trace privacy / lifecycle / operational rollout
- Issue #47: personalization / cloud session authority（current-time safety自体は完了）
- Issue #51: cross-tab / cross-device approval uniqueness
- Issue #52: weekly planning UIをgeneric Quick Entry / AI inputから分離
- Issue #89: trace empty-session production / operational verification
- Issue #115: raw-text regex weekly entry routingをAI-owned structured routingへ移行
- Issue #118: completed-work paceからremaining effortをdeterministicに導出
- Issue #128: saved-preview approval compatibility migration

Issue #52 / #115は構造監査で実在を再確認しているが、PR #129の挙動不変refactorとして黙って実装しない。

## 8. 非blocking構造負債

- `DayView`: timetable import / detail modal composition
- `BookshelfView`: subject/material modal lifecycle
- `AdminViews`: user list/detail loading + routing
- `MonthEventDialog`: save normalization / recurrence delete scope / editor UI
- `MonthView`: pager gesture / keyboard navigation / projection / rendering
- production buildの既存chunk/code-splitting warning

これらは次のfile-by-file phaseで、対象回帰を先に用意できる単位から処理する。

## 9. 次の進行条件

1. PR #129 post-audit HEADのnormal CI green
2. Browser Regression 80/80 green
3. 七視点監査に新しいBLOCKER/MAJORが出た場合は次ファイルへ進まず同PRで修正
4. 仕様変更が必要な場合だけユーザー確認
5. green checkpoint後に残りfile-by-file auditを再開
