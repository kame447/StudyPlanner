# 全コード SOLID file-by-file 監査・MD棚卸し

Status: active

Branch: `agent/browser-regression-audited-integration`
Baseline main: `621c1176e8b5bc3740c2f273fdeb48d9b43cfdcb`
Started: 2026-08-14

## Goal

リポジトリ全体を1ファイルずつ確認し、振る舞いを不要に変えずに SOLID 原則・責務境界・変更理由の凝集度を監査する。改善が必要なファイルだけを段階的にリファクタリングし、各ループで関連テストと文書を更新する。同時に Markdown を棚卸しし、active / closed / superseded / stale / specification-conflict を整理する。

## Non-negotiable architecture

- AI は raw natural language の意味理解・文脈理解・構造化を担当する。
- deterministic code は validation、evidence/reference、Fact Graph lifecycle、revision/idempotency、確認要否、進行方針、readiness、scheduler、preview、approval、save、persistence/safety を担当する。
- raw Japanese text を regex / keyword / parser で再解釈して semantic truth にしない。
- 類似機能はファイル位置ではなく責務・変更理由でカプセル化し、caller には小さく安定した facade/application API を公開する。
- 型で表現可能な状態遷移・不変条件は型へ寄せる。

## SOLID audit criteria

- SRP: 1ファイル/1モジュールが複数の独立した変更理由を持っていないか。
- OCP: 新しい分岐追加のたびに中央オーケストレータを直接編集する構造になっていないか。
- LSP: interface/contract の実装が呼び出し側の期待・不変条件を破っていないか。
- ISP: caller が不要な巨大interfaceや実装詳細へ依存していないか。
- DIP: application/domain が concrete storage/provider/singleton/UI detail に逆向き依存していないか。

## Test audit rule

テスト失敗は必ず以下に分類する。

1. implementation defect → production code を修正する。
2. stale / incorrect test contract → 仕様根拠を確認して test を修正する。
3. harness boundary issue → harness を修正する。

Green化だけを目的に regression を削除・弱体化しない。

## Markdown change safety rule

- 2026-08-14 に新規作成した本台帳は各ループで必ず更新する。
- 直近作成の進捗/closed記録は、仕様を変えない範囲で更新してよい。
- 古い Markdown で仕様・architecture contract・product behavior を変更する必要が出た場合は、変更前にユーザー確認を取る。
- 承認前は旧MDを削除・書き換えず、`requires-user-confirmation` として本台帳へ記録する。

## Loop protocol

各ループは次の順で完了させる。

1. 対象ファイルを読む。
2. SOLID / duplication / encapsulation / dependency direction / stale contract を判定する。
3. `no change` または最小の責務単位で修正する。
4. 必要な focused regression を実行・確認する。
5. 本台帳と、そのループで変更可能な参照MDを更新する。
6. そのループの結果・残件を記録してから次へ進む。

## MD inventory findings

### requires-user-confirmation

- `AGENTS.md`: `Natural language scheduling rules` が staged parser (`normalize → tokenize → clause parsing → AST → IR → compile → validate`) と旧planner/fallback維持を規定しており、現在の Stable V5 の AI semantic ownership / deterministic control 方針と競合している。古い仕様文書のため未変更。

### stale-active candidates

- `docs/ai/tasks/20260730-weekly-planning-stable-v5-ai-dialogue-renderer.md`: closed record確認後、active queueから削除済み。
- `docs/ai/tasks/20260731-weekly-planning-midweek-current-time-start-boundary.md`: 未実装表記だがPR #120で実装済み、closed記録あり。active queue削除候補。
- `docs/ai/tasks/20260731-weekly-planning-stable-v5-verification-and-cutover.md`: pre-cutoverのactive gateを保持しているがclosed記録あり。active queue削除候補。

## Loop ledger

| Loop | Primary file | Result | Verification | MD update | Status |
|---|---|---|---|---|---|
| 0 | repository / workflow preflight | PR #127 はmerge済みで再利用不可。削除済み同名branchを current main から復元。既存open Issue/PRに同一SOLID監査タスクなし。 | branch baseline = main `621c117...` | 本台帳作成。`AGENTS.md`仕様競合を保留登録。 | done |
| 1 | `src/components/DisplaySettingsDialog.tsx` | deprecated `export {}` shimで参照元がなく、dead compatibility surfaceのため削除。 | repository code searchで`DisplaySettingsDialog`参照0件。behavior changeなし。 | 本台帳にLoop 1とstale-active MD候補を追記。 | done |
| 2 | `src/main.tsx` | bootstrap・admin route split・trace setup・preloadだけを所有する薄いcomposition root。no-change。 | `AdminApp` / `StudyPlannerAppRoot`へのentrypoint依存を確認。 | 本台帳へLoop 2を追記。 | done |
| 3 | `src/App.tsx` | view navigation表示を`AppViewSwitcher`へ抽出し、7つのview定義を単一データへ集約。Appはcompositionへ寄せた。 | `AppViewSwitcher.test.tsx`を追加。既存`ViewMode`型を使用し状態契約は不変。 | 本台帳へLoop 3を追記。 | done |
| 4 | `src/components/StudyPlannerAppRoot.tsx` | startup/consent/week-startのlocal component分割は妥当。`App.tsx`とのlegal route判定重複を発見。 | route重複をrepository searchで確認。抽出module作成はconnector safety blockのため未適用。 | 本台帳へdeferred refactorを記録。 | done |
| 5 | `src/features/weeklyPlanning/parsing/weeklyPlanningText.ts` | raw text normalizationとlegacy semantic predicatesが同居。`looksLikeWeeklyPlanningRequest`はproduction entry routingのsemantic ownership違反。`isPlacementConditionOnly`も到達性監査が必要。 | `looksLikeWeeklyPlanningRequest`が`NaturalLanguageAssistant`から参照されることを確認。Issue #115と一致。 | 本台帳へIssue #115との対応を記録。 | done |
| 6 | `src/components/NaturalLanguageAssistant.tsx` | 単発AI提案、週間計画request制御、会話、preview promotion/approval、24h preview描画を1componentが所有。SRP/ISP違反でIssue #52の根拠。段階抽出対象。 | 全体を4chunkで読了。#115 regex routingのproduction callerも再確認。 | 本台帳へ#52責務分離候補を記録。 | done |
| 7 | `src/components/QuickEntryModal.tsx` | modal shell、manual plan/Todo/repeat、actual記録/紐付け、教材推論、AI/weekly delegationを同時所有。weekly propsの大量prop drillingもISP違反。 | 全体を3chunkで読了し`WeeklyPlanningQuickEntryModal` facadeからの展開を確認。 | 本台帳へ#52の第2責務分離対象として記録。 | done |
| 8 | `src/components/WeeklyPlanningQuickEntryModal.tsx` | `WeeklyPlanningApplication`を現在のQuickEntry contractへ適合させるcompatibility adapter。現時点では変更理由が一つなのでno-change。#52完了時に縮退対象。 | application→QuickEntry prop mappingとapproval availability projectionを全体確認。 | 本台帳へ移行順序を記録。 | done |
| 9 | `src/components/RootManagedAuthenticationContext.tsx` | root-managed authの有無だけを伝える1bit coordination contract。小さく凝集しておりno-change。 | `useAuthSessionState`がlogin後の二重state更新を避けるため利用していることを確認。 | 本台帳へLoop 9を追記。 | done |

## Remaining-problem register

- Issue #116 はstale cleanup対象がcurrent repositoryから消えていることを確認し、completedでclose済み。
- Issue #115: fresh-session weekly routingをraw-text regexが所有している。SOLID整理だけで黙って削除せず、semantic router契約として実装する必要がある。
- Issue #52: `NaturalLanguageAssistant` と `QuickEntryModal` がgeneric/manual/weekly責務を混在させている。weekly専用surfaceへ段階分離し、application facadeを個別propへ展開しない境界へ寄せる。`WeeklyPlanningQuickEntryModal`はその移行adapterとして現時点では維持する。
- `isPlacementConditionOnly`のproduction reachabilityを継続監査する。
- `App.tsx` / `StudyPlannerAppRoot.tsx` のlegal route policy重複は小規模なdeferred refactor。
- その他のopen Issueとコード/MDを照合中。
