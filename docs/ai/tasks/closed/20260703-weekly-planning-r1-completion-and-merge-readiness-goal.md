# [Goal] R1 完了監査と main merge readiness の確立

`feat/weekly-planning-draft-mvp` の weeklyPlanning R1(command boundary 完成・reducer 薄化・legacy fallback 整理・R1 範囲の回帰固定)を完了扱いにし、main merge 前の判断材料を揃えるための goal md である。Codex が1回の goal 作業として実行する。

## 運用ルール(必読)

- **mdに書かれていない範囲へ進まないこと。**
- 将来候補・別作業・設計判断が必要な項目は、調査だけでも勝手に進めないこと。
- 対象外の問題を見つけた場合は、修正せず「発見事項」として報告すること。
- git add / commit / push はしないこと。コミットはユーザー指示後に行う。
- Phase をまたいで変更を混ぜないこと(各 Phase の報告・コミット単位を分けられる状態を保つ)。
- テストの期待値変更が必要な場合は、それが「現状固定」なのか「intended behavior 変更」なのかを必ず明記すること。R1 完了監査の性質上、このmdでは原則として intended behavior 変更を行わない。

## 背景

R1 は親 goal(`tasks/closed/20260703-weekly-planning-r1-command-boundary-goal.md`)以降、次の順で進んできた: command 化(progressHint / uncertainty / no_fixed_events、それ以前に exam scope / planning range / constraints / priority / progress / unit rate)→ legacy fallback の regression 固定(reducer 直呼び + pipeline)→ fallback の単一モジュール隔離と named 関数分割 → priority missing ブロックの `weeklyPlanningMissingStatus.ts` 移設 → `tasks_or_goals` missing 不整合の解消(直近コミット `ec49842`)。

残っているのは、「R1 が本当に完了しているか」の横断監査と、監査で見つかる小さい残作業の回収、main merge 可否の判断である。R2 以降の新機能には一切進まない。

## 目的

1. R1 の完了監査を行う。
2. reducer に自然言語解釈・parser 的責務が残っていないか確認する。
3. legacy fallback が単一境界(`weeklyPlanningLegacyFallback.ts`)に隔離され、branch A / branch B の条件が named 述語として明示されているか確認する。
4. `tasks_or_goals` missing 不整合が解消済みであることを確認する。
5. R1 で command 化した処理が reducer 直書きに戻っていないか確認する。
6. `constraintToBusyInterval` / busy interval 周辺の暗黙推定ルール(例: meal の end−60分既定、durationMinutes fallback、date-less constraint の展開)に、R1 完了前に固定すべきテスト不足が残っていないか確認する。
7. 既知失敗 `scheduling/placementScoring.test.ts` 1件(timetable template busy interval のケース)が main merge blocker かどうか判断する。
8. 小さく特定できる R1 残作業だけを実装する。
9. 最後に main merge 可否を報告する。

## 対象ファイル

- Phase 1(調査のみ): 下記「Phase 1 の確認対象」参照。変更なし。
- Phase 2(最小実装): Phase 1 の結果に基づき、「許可する作業」の範囲内で必要なファイルのみ。想定は intake 配下(reducer / fallback / missingStatus / parser / adapter)、scheduling の**テストのみ**(`weeklyDraftCandidateGenerator.test.ts` 等への現状固定テスト追加)、`scheduling/placementScoring.test.ts`(既知失敗の原因が小さい場合のみ)、`docs/ai/tasks/` 配下のmd整理。
- Phase 3〜4: 変更なし(検証と報告)。

## フェーズ構成

### Phase 1: R1 完了監査(調査のみ)

現在の実コードとテストを確認し、R1 完了に必要な残作業を洗い出す。**production code も test も変更しない。** 残作業一覧(Phase 2 で実装するもの/しないもの/対象外として発見事項に回すもの)を報告する。

確認対象(最低限):

- `src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts` — 日本語正規表現・parser 直接呼び出し・missing/status 判定の直書きが残っていないか。command の parse / apply の orchestration + fallback 呼び出し1箇所 + finalizeState だけになっているか。
- `src/features/weeklyPlanning/intake/weeklyPlanningLegacyFallback.ts` — branch A / branch B が named 述語・named 関数で明示され、TODO(Phase 9.8)と truthiness コメントが残っているか。`tasks_or_goals` 除去が tasks 置換パスに限定されているか。
- `src/features/weeklyPlanning/intake/weeklyPlanningMissingStatus.ts` — `applyPriorityMissingState` を含む missing/status 判定がここに集約されているか。
- `src/features/weeklyPlanning/intake/weeklyPlanningCommandTypes.ts` / `weeklyPlanningCommandAdapter.ts` — command union と adapter の対応が揃っているか。未使用 export・dead code がないか。
- intake 配下の parser 群(`weekly*Parsing.ts`)— domain state を直接 mutate していないか。reducer からの直接 state 反映経路が復活していないか。
- `src/features/weeklyPlanning/scheduling/weeklyPlanningConstraintScheduling.ts` / `weeklyDraftCandidateGenerator.ts` — `constraintToBusyInterval` 等の暗黙推定ルールを列挙し、どれがテストで固定済みか・未固定かを整理する(**調査のみ。実装変更はしない**)。
- `scheduling/placementScoring.test.ts` — 既知失敗1件の失敗内容と原因箇所を特定する(timetable template を busy interval として扱う期待)。原因が「小さい」(例: テスト前提のずれ、1関数内の明確な欠落)か「大きい」(scheduler 本体の設計に関わる)かを判定する。
- fallback / pipeline / edge cases / roleplay 系テスト — R1 で固定した regression(fallback 直呼び・pipeline・priority missing・no_fixed_events・progress boundary・uncertainty・separator)が揃っているかの棚卸し。
- `docs/ai/tasks/` の open / closed 状態 — open に残る `20260703-weekly-planning-r1-fallback-semantics-goal.md`(Phase 4 設計まで完了済みのはず)を closed へ移動すべきかを判定する。closed 配下の記録との整合。

### Phase 2: R1 残作業の最小実装

Phase 1 で見つかった R1 残作業**だけ**を実装する。許可する作業は以下に限定する。これに該当しない残作業は実装せず、Phase 4 の報告で「merge 後に回すべき作業」として列挙する。

- reducer に残った自然言語解釈・parser 的責務の除去(見つかった場合)。
- missing / status 判定の責務整理(`weeklyPlanningMissingStatus.ts` への集約。挙動変更なしに限る)。
- legacy fallback 周辺の挙動変更なし整理(コメント・named 述語の補強など)。
- `constraintToBusyInterval` / busy interval 暗黙推定ルールの**現状固定テスト追加**(production 変更はしない。期待値は観察から書く)。
- R1 完了に必要な小さい regression test 追加。
- 既知失敗 `placementScoring.test.ts` の原因が「小さい」と判定できた場合のみ、その最小修正(現状固定か intended 修正かを明記。判断に迷う場合は修正せず Phase 4 で blocker 判定に回す)。
- 完了済み task md(`20260703-weekly-planning-r1-fallback-semantics-goal.md` 等)の `docs/ai/tasks/closed/` への移動。
- R1 完了メモの追加。**closed 配下の既存記録は原則書き換えず**、新しい完了記録md(例: `docs/ai/tasks/closed/20260703-weekly-planning-r1-completion-report.md`)を作る。

### Phase 3: main merge 前の安定化確認

Node 22 PATH 付きで以下を実行する。

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/__tests__/weeklyPlanningLegacyFallback.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/__tests__/weeklyPlanningIntakeEdgeCases.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check
git diff --stat
git status -sb
```

既知の `placementScoring.test.ts` 1件が残る場合、それが **main merge blocker なのか、R8 側(配置品質と scheduler 整合)の後続課題として残してよいのか**を、Phase 1 の原因特定に基づいて明確に判断する。判断基準の目安: 保存・承認導線や既存機能の実挙動に影響する欠落なら blocker、weekly 配置品質の未実装期待(テストが先行している状態)なら R8 送りを許容。

### Phase 4: R1 完了レポート(報告して停止)

R1 を完了扱いできるか、main merge してよいかを報告して停止する。報告項目(最低限):

- R1 完了可否
- 実装したこと / 実装しなかったこと(理由つき)
- reducer に自然言語解釈が残っていないか
- legacy fallback の現在の境界と、fallback がまだ残存している理由(意味論整理は R2 以降の設計判断であること)
- busy interval / constraint 周辺の暗黙推定テストの状態(固定済み/未固定の一覧)
- known failure(placementScoring)の扱いと判断根拠
- main merge 可否 / merge 前に残る blocker
- merge 後に R2 以降へ回すべき作業(fallback 意味論整理・初回/継続ターン定義・R2 テーマ等)
- 実行したテスト / build の結果
- `git diff --check` / `git diff --stat` / `git status -sb`

## 各フェーズの受け入れ条件

- **Phase 1**: 確認対象すべてについて結果が報告され、残作業が「Phase 2 で実装 / merge 後送り / 対象外(発見事項)」に分類されている。`git diff` が空のまま。
- **Phase 2**: 実装が「許可する作業」の範囲内に収まっている。挙動変更なしの整理はその根拠が、テスト追加は観察に基づく期待値であることが報告されている。既存テストの期待値変更がある場合は現状固定/intended の区別が明記されている。
- **Phase 3**: 全コマンドが実行・報告され、placementScoring 既知1件以外の失敗がない。既知1件の blocker 判定が根拠つきでされている。
- **Phase 4**: 報告項目がすべて埋まり、そこで停止している。

## 触らない範囲(禁止)

- R2 以降の新機能全般。特に: 締切表現 parser、完了条件 parser、ページ数・語数・問題数対応、`TaskProgressScope` / `unitKind` 一般化、質問計画、生活プロファイル、進捗記録、再計画。
- scheduler 二系統統合、`weeklyDraftCandidateGenerator.ts` / `availabilitySlots.ts` / `placementScoring.ts` の本体改造(placementScoring は既知失敗の最小修正が許可された場合のみ、その範囲で)。
- UI 大改修、保存/承認導線の仕様変更、通常予定導線の変更。
- LLM 接続、LangGraph 導入。
- pipeline の初回/継続ターン意味論の大改修、`isFirstTurn` 導入、`looksLikeWeeklyPlanningRequest` の仕様変更、branch B の発火条件変更。
- `weeklyPlanningTransforms.ts` の仕様変更(読むのは可)。
- closed 配下の既存 task md の書き換え(新規の完了記録mdは可)。
- 既存 regression テストの入力・期待値(Phase 2 で許可された現状固定/最小修正を除く)。

## 停止条件

- Phase 2 の残作業が「許可する作業」に収まらないと判明したとき(実装せず Phase 4 の報告へ回す)。
- placementScoring の修正が scheduler 本体の設計変更を要すると判明したとき(修正せず blocker/R8 判定へ)。
- 変更が intake / scheduling テスト / docs/ai/tasks の外へ波及したとき。
- 「触らない範囲」に関わる変更・調査が必要に見えたとき(発見事項として報告し、進めない)。
- placementScoring 既知1件以外の説明できない新規失敗が出たとき。

## テスト観点

- Phase 2 で追加するテストはすべて現状固定(観察 → 期待値)。スナップショット禁止、日本語は生文字列(`\uXXXX` 禁止)、日本語リテラル(特に「、」)は diff で目視確認する。
- busy interval 系の固定テストは `scheduling/weeklyDraftCandidateGenerator.test.ts`(または適切な既存 scheduling テスト)に置き、describe / it 名で「暗黙推定の固定」であることが分かるようにする。
- test / build は Node 22 系で実行する(Phase 3 のコマンド形式)。

## Codexへの実装指示

1. Phase 1 → 2 → 3 → 4 の順に進め、Phase をまたいで変更を混ぜない。Phase 1 の残作業一覧を報告してから Phase 2 に入る。
2. Phase 2 は「許可する作業」リストの範囲内のみ。1項目でも範囲を超えそうなら、その項目は実装せず Phase 4 の報告へ回す。
3. placementScoring の既知失敗は、まず原因を特定して「小さい/大きい」を判定し、大きい場合は修正しない。修正する場合は、それが現状固定なのか intended 修正なのかを明記する。
4. R1 完了記録は新規md(`docs/ai/tasks/closed/20260703-weekly-planning-r1-completion-report.md` 等)として作成し、closed 配下の既存記録を書き換えない。
5. 期待値は観察してから書く。不自然な挙動・対象外の気づきは修正せず発見事項として報告する。
6. git add / commit / push はしない。コミットはユーザー指示後に行う。
7. `docs/ai/codex-task-guide.md` に従う。
