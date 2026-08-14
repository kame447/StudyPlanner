# SOLID file-by-file refactor 七視点監査

Date: 2026-08-14
Branch: `agent/browser-regression-audited-integration`
PR: #129
Baseline main: `621c1176e8b5bc3740c2f273fdeb48d9b43cfdcb`
Scope: file-by-file SOLID hardening / MD inventory / behavior-preserving refactor

## 結論

初回敵対的監査時点では採用不可だった。

主因は、`DailyMaterialShelf`抽出でmissing subject fallback metadataの決定順序が変わる実挙動回帰、Loop 25の大きなday-material抽出に対する直接component regression不足、ReportViewのdead prop contract、Browser Regression harnessの古いPlaywright固定、MD進捗/active queueの不整合である。

確定可能な項目はPR #129上で修正ループを回した。Stable V5のAI semantic ownership / deterministic control boundary、persistence schema、scheduler policy、approval/save contractには変更を加えていない。

最終判定は、post-audit HEADでnormal CIとBrowser Regressionの両方がgreenになることを条件とする。

## 監査1: アーキテクチャと責務境界

判定: PASS

確認した主な抽出:

- `App.tsx` → `AppViewSwitcher.tsx`
- `AppSettingsDialog.tsx` → `AppSettingsSupportPanel.tsx`
- `ActualEditorCard.tsx` → `actualDrafts.ts`
- `ActualTrackingTools.tsx` → `actualTracking.ts`
- `AdminViews.tsx` → `AdminReportViews.tsx`
- `AuthScreen.tsx` → `AuthAccessGateForm.tsx`
- `BookshelfView.tsx` → `bookshelfMaterials.ts`
- `DatePickerDialogs.tsx` → `DayCalendarDialog.tsx`
- `DayTimeline.tsx` → `dayTimelineLayout.ts`
- `DayView.tsx` → `DailyMaterialShelf.tsx` / `MaterialQuickCreateModal.tsx`
- `StandaloneActualEditorCard.tsx` → `standaloneActualDrafts.ts`

単にファイルを小さくするための分割ではなく、presentation、pure projection、collection normalization、interaction flowなど独立した変更理由で分離されている。

`AdminApp`、`AdminGuard`、`AiRuntimeSettings`、`FloatingActualTrackingPanel`、初回privacy/week-start画面、`LegalPage`、`MyPageDialog`、`PlanFieldsEditor`、`PlanEditorPanel`、`TimeRangeFields`、`MonthPickerDialog`は、監査したうえで過剰分割を避けno-changeとした。

`MonthEventDialog`と`MonthView`は構造負債を確認したが、高結合なinteractionを回帰証拠なしで分解しない判断を維持した。

週間計画runtimeのsemantic ownershipは変更していない。raw Japaneseをregex/keyword/parserでsemantic truthへ戻す変更もない。

## 監査2: 挙動保持・型・caller contract

初回判定: MAJOR
実装後判定: PASS pending final-head CI

実際の回帰を1件検出した。

Loop 25以前の`DailyMaterialShelf`では、missing subjectのfallback name/colorを元materials配列で最初に現れた教材から決め、その後cardをsortしていた。抽出後はgroup内sort後の先頭教材からfallback metadataを取る形になり、同一subjectIdに不整合なlegacy metadataが残る場合に表示が変わり得た。

修正:

- `buildSubjectsWithMaterialFallback`でsource-orderのfallback subject identityを先に確定
- card list sortingとは独立させた
- conflicting legacy metadataを持つ2教材のcomponent regressionを追加

また`ReportView`は`dayNote`、`monthEvents`、`onSaveDayNote`をrequired propsとして受けながら明示的に捨てていた。これはISP上のdead contractであり、`App`側の`createEmptyDayNoteDraft`、`currentDayNote`、`saveDayNote`のreport専用plumbingとともに削除した。report aggregation/rendering branch自体は変更していない。

`ActualEditorCard`、`DayTimeline`、`StandaloneActualEditorCard`、`AdminReportViews`、`DayCalendarDialog`、`AppSettingsSupportPanel`はmain側の元実装と対応を比較し、意味変更ではないことを確認した。

## 監査3: 状態・data invariant・persisted compatibility

判定: PASS

確認した不変条件:

- Plan / Actual identityを変更しない
- occurrenceDate / occurrence keyの意味を変更しない
- explicit `isAlignedToPlan`を優先し、legacy actualのみtitle/subjectからalignment推定する
- actual relink candidateで既存identityを維持する
- standalone actual保存ではtrim済み値、link candidate scoringでは従来どおりraw edit valueを使う
- 24:00 same-day clampを維持する
- day material quick-createのcross-midnight `% 24h` clock behaviorを維持する
- materialId / materialName provenanceを維持する
- recurrence / approval / weekly Fact Graph / persistence schemaを変更しない

今回の変更は保存migrationや旧preview compatibility contractを変更していない。Issue #128の責務へ踏み込んでいない。

## 監査4: UX・browser・accessibility

判定: PASS pending final Browser Regression

抽出時に既存class名、主要DOM structure、label、tab role、modal overlay behavior、callback contractを維持した。

直接coverageが弱かったday-material flowには以下を追加した。

- `DailyMaterialShelf.test.tsx`
- `MaterialQuickCreateModal.test.tsx`

`MaterialQuickCreateModal`ではdefault standalone actual、23:45 + 30分 → 00:15のcross-midnight、plan tab draft mappingを固定した。

PR #129のpre-final hardening head `f8eea8348ecbc456046efd3915aa12af3b720e38`ではBrowser Regression 80/80がgreenになっている。post-audit HEADでも同じ80件を通すことを完了条件とする。

## 監査5: Test品質・harness境界

初回判定: MAJOR
実装後判定: PASS pending final Browser Regression

初期refactorではpure helper testは追加されていたが、Loop 25の大きなcomponent抽出に直接testがなく、実際にfallback ordering regressionを見逃した。

修正後はpure helperとcomponent boundaryを分けて検証する。

追加・維持したfocused regression:

- `actualDrafts.test.ts`
- `actualTracking.test.ts`
- `bookshelfMaterials.test.ts`
- `dayTimelineLayout.test.ts`
- `standaloneActualDrafts.test.ts`
- `AppViewSwitcher.test.tsx`
- `AuthAccessGateForm.test.tsx`
- `AdminReportViews.test.tsx`
- `DailyMaterialShelf.test.tsx`
- `MaterialQuickCreateModal.test.tsx`

またBrowser Regression workflowはapplication dependencyと分離した`tests/e2e` runnerを使っている。旧固定`@playwright/test@1.55.0`のinstallがhigh-severity audit findingを2件報告したため、production dependencyを変更せず、公式latest stable `1.62.1`へisolated runnerだけを更新した。application manifestsのchecksum guardは維持する。

テスト失敗時はimplementation / stale test contract / harnessの3分類を継続する。

## 監査6: 観測性・security・dependency trust

判定: PASS WITH NONBLOCKING DEBT

このrefactorはtrace schema、AI request payload、privacy boundary、Firebase repository、approval persistenceを変更していない。

application側の`npm ci`ではpre-final verified headで0 vulnerabilitiesだった。

Browser Regression runnerのdependency warningはproductionへ転嫁せずharness側で処理した。

production buildには既存のVite warningが残る。

- `naturalLanguageCatalog.ts`のdynamic/static import併用
- `repositories/index.ts`のdynamic/static import併用
- main chunk > 500kB warning

これらは今回の責務抽出で導入されたcorrectness defectとは確認できず、performance/code-splitting debtとして非blocker扱いとする。今回の7視点fix loopで無理にbundle architectureを変更しない。

## 監査7: 文書・Git・merge hygiene

初回判定: MAJOR
実装後判定: PASS pending final-head checks

Git:

- 新規branchは増やしていない
- refactor用に追加したPRはユーザー承認済みの1本のみ: PR #129
- PR #129はdraftのまま維持
- branch名はmerge済み#127由来で歴史的には紛らわしいが、ここでbranchを置換すると余計なGit surfaceを増やすため維持

文書:

- `AGENTS.md`と`weekly-planning-pipeline-guide.md`はユーザー承認後にStable V5 current contractへ同期済み
- SOLID loop logと専用roadmapを毎loop更新
- `weekly-planning-docs-index.md`の旧Phase 3 / cleanup branch / superseded execution task参照をcurrent PR #129へ同期
- closed記録が既にあるroot task duplicateを3件削除
  - `20260731-weekly-planning-midweek-current-time-start-boundary.md`
  - `20260731-weekly-planning-stable-v5-verification-and-cutover.md`
  - `20260812-weekly-planning-legacy-concept-migration-and-real-api-audit.md`
- `20260810-weekly-planning-human-reviewed-conversation-improvement-loop.md`はcompleted表記だがclosed copyが存在しないため、今回の自動削除対象にはしなかった

## 実装修正の確定範囲

七視点監査までに確定修正したもの:

1. `DailyMaterialShelf` fallback metadata ordering regression修正
2. `DailyMaterialShelf` component regression追加
3. `MaterialQuickCreateModal` component regression追加
4. `ReportView` dead prop / App caller plumbing削除
5. isolated Browser Regression runnerをPlaywright 1.62.1へ更新
6. stale documentation index更新
7. closed recordと重複したroot task 3件削除
8. loop log / refactor roadmap同期

## 残余構造負債

今回の監査で存在を確認したが、別の変更理由または高リスクのため自動修正しないもの:

- `DayView`: timetable import / detail modal composition
- `BookshelfView`: subject/material modal lifecycle
- `AdminViews`: user list/detail loading + route composition
- `MonthEventDialog`: save normalization / recurrence delete scope / UI混在
- `MonthView`: pager gesture / keyboard / projection / rendering混在
- `NaturalLanguageAssistant` / `QuickEntryModal`: Issue #52
- raw-text weekly entry routing: Issue #115
- trace/privacy lifecycle: Issue #45
- cross-device approval uniqueness: Issue #51
- saved-preview compatibility: Issue #128

これらをPR #129へ巨大rewriteとして混在させない。

## 検証記録

pre-final hardening head `f8eea8348ecbc456046efd3915aa12af3b720e38`:

- normal CI: success
  - `npm ci`
  - typecheck
  - Vitest
  - production build
  - PR diff check
- Browser Regression: success
  - production build
  - Chromium
  - 80 / 80 passed

その後、Playwright runner更新、ReportView dead contract削除、MD hygiene修正を行ったため、post-audit HEADでもnormal CIとBrowser Regressionを再実行し、両方greenであることを最終条件とする。

## 完了判定

コード/MD監査で確定できた指摘の修正ループは完了。

PR #129をmerge-readyと判定できる条件は、post-audit HEADでnormal CIとBrowser Regression 80/80がgreenであること。赤の場合は次ファイル監査へ進まず、failureを3分類して同PRで修正→七視点再判定を続ける。
