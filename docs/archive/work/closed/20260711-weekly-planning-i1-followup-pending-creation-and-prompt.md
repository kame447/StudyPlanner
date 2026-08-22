# I1追修正: 曜日回答の prompt 不整合を解消し、AI 経路で pendingPlanningRange を生成可能にする

Priority: **High**(理由: 監査(2026-07-11)で確認した2件とも provider モードの主要導線を破断させる。A は「水曜日から」型の開始日回答を実 AI が構造的に無視する prompt–validator 矛盾、B は「来週の計画を立てたい」型の開始発話が I1 以前は成立していたのに catch-all へ逆戻りする regression)

本mdの範囲外へ進まない。git add / commit / push はしない。

**前提**: I1(commit `ce2713a`)・I2(会話履歴供給)実装済み。親設計 `docs/architecture/weekly-planning-dialogue-architecture.md`(v3)§2〜§3。着手時に実コードが本mdと食い違えば実装せず報告する。

## 背景(監査結果)

I1 は provider 利用時の意味解釈を AI interpreter に一本化し、deterministic semantic parse をバイパスした。監査で次の2件を確認した:

- **A(prompt 不整合)**: system prompt に I1 以前の記述が残置されている:
  > `When stateSummary.pendingPlanningRange exists, emit set_planning_range only if the current turn explicitly states a start date. Do not infer a date; weekday answers are resolved by the deterministic parser.`
  provider モードに deterministic parser は存在しないため、この指示に従う実 AI は「水曜日から」を日付化せず、I1 が実装した **pending 窓内受理(validator)は準拠モデルでは到達不能**。stub テストは prompt を経由しないため green のまま検出できない。
- **B(pending 生成経路の欠落)**: `set_pending_planning_range` は AI schema にも `KNOWN_COMMAND_TYPES` にも無く、provider 経路では deterministic setup parse も走らない。このため「来週の計画を立てたい」に対して AI は(安全則に従い)空を返すしかなく、**I1 以前の provider モードでは成立していた「来週 scope 保持 + 開始日 clarification」が catch-all(`cannot_create_draft`)へ退行**する。

## B の帰属判断(本タスクに含める根拠)

B は P3(entry intent)ではなく**本追修正 = I1 契約の完了**として扱う:

1. 親設計 v3 §2-3 の「AI の出力は typed command」の command 空間は `ParsedWeeklyPlanningCommand` 全体であり、`set_pending_planning_range` を AI から表現不能なまま deterministic 経路だけ塞ぐのは v3 §2-1(単一解釈)の実装漏れである。
2. v3 §3 は `parseSetPendingPlanningRangeCommand` を「semantic parser(廃止・縮小)」に分類しており、その**意味判定の移行先は AI**と定めている。移行先が無い現状は分類表と矛盾する。
3. temporal-scope 仕様(closed `20260709-weekly-planning-temporal-scope-start-clarification.md`)の確定意味論「来週 → scope 保持・開始日 clarification・hard apply 禁止」は維持対象であり、AI に inferred `set_planning_range` で代替させる回避策は仕様違反になる。pending command が唯一の正しい表現。
4. P3 md は「来週の計画を立てたい → pending → 水曜日から」の既存フローが **green のままであることを受け入れ条件(条件4)の前提**にしており、pending 生成の provider 対応を実装対象にしていない(P3 の deterministic gate 拡充は rules fallback の範囲)。

よって本タスクで B を修正し、P3 の前提を回復する。

## 目的

provider モードで (A) pending 中の曜日・短答の開始日回答が AI により explicit な ISO 日付へ解決され、窓内検証を経て適用されること、(B) 将来 scope の開始発話が pending clarification として成立すること。

## 計画書との対応

- spec: §5(範囲の聞き取り)
- 改善テーマ: 親設計 v3 §2-1・§3 / I1(`20260711-weekly-planning-ai-interpretation-stage1-single-interpreter.md`)の受け入れ条件4 の実効化 / temporal-scope 仕様の維持

## 対象ファイル

- 変更:
  - `src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts`(A: 残置行の置換 / B: `set_pending_planning_range` schema + prompt bullet)
  - `src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts`(B: `KNOWN_COMMAND_TYPES` / `hasRequiredShape` / enum・値域検証 / `commandSlotKeys`)
  - `src/features/weeklyPlanning/intake/weeklyPlanningCommandAdapter.ts`(B: next_week 窓の deterministic 補完)
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts`(B: AI command 適用前の正規化 map への組み込み — 既存の `set_planning_range` 正規化と同じ箇所)
  - 必要な場合のみ `src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts`(`nextWeekScope` 相当の窓算出を export して再利用する場合。ロジック変更は不可)
- 新規: なし
- テスト:
  - `src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts`
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts`

## 現在の処理経路(要点)

- provider 経路: `beginWeeklyPlanningUserTurn`(parse なし)→ AI → `resolveConstraintSourceReferences` → `validateInterpretedCandidates` → 正規化 map(`set_planning_range` のみ `toPlanningRangeFromSetPlanningRangeCommand`)→ `applyWeeklyPlanningCommands` → `finalizeState`。
- validator の pending 分岐: 非 explicit → `pending-range-clarification` reject / explicit かつ窓内(`scope.startDate`〜`endDate`)→ 通常の slot 検査へ(accepted 可)/ 窓外・窓不明 → acceptedWithConfirmation(pipeline が pending 中の適用から除外)。
- reducer には `case 'set_pending_planning_range'`(pendingPlanningRange 設定 + `planning_start_date` seed)が実装済み。欠けているのは AI からの到達経路のみ。

## 修正方針

### A. prompt の確定修正(1行置換)

背景に引用した残置行を削除し、次の趣旨の指示に置き換える(英語・2文程度):

> stateSummary.pendingPlanningRange があるとき、曜日や短い開始日回答(例: 水曜日から)は pendingPlanningRange.startDate / endDate と context.currentDateTime を使って **pending 窓内の explicit な ISO 日付に解決し**、`set_planning_range`(confidence explicit・range.confidence 'explicit')として emit せよ。窓内かどうかの最終検証はアプリが行う。具体的な日付に解決できない場合は range 系 command を出すな。

既存の安全則(捏造禁止・不確実なら出さない)と矛盾しない書き方にする。

### B. `set_pending_planning_range` の AI 経路開通

1. **schema**(`WEEKLY_PLANNING_COMMAND_SCHEMAS`): `pending: { scope: { kind: 'next_week' | 'named_future_period', label: string, startDate?: string, endDate?: string }, durationDays?: integer, sourceText: string }`。
2. **prompt bullet**(1項目): ユーザーが解決可能な開始日なしに将来の計画 scope を述べたとき(「来週の計画/予定を立てたい」「夏休みの一週間で」)に emit する。`scope.kind` と発話由来の `label` を設定し、**startDate/endDate は発話に明示が無い限り埋めない**(next_week の窓はアプリが計算する)。inferred な `set_planning_range` で代替しない。
3. **validator**: `KNOWN_COMMAND_TYPES` 追加 / shape(scope.kind・label 必須)/ enum(`kind` 2値)/ 値域(startDate・endDate は `isDate`、durationDays は正の整数)/ `commandSlotKeys` → `['planning_range']`(range 確定済み state への pending 上書きを confirmed-slot guard で reject)。
4. **正規化(deterministic)**: adapter に純関数を追加し、`scope.kind === 'next_week'` かつ startDate/endDate 欠落時に context の currentDateTime から翌週の窓(既存 `nextWeekScope` と同一の算式: 翌週月曜〜日曜)を補完、`durationDays` 欠落時は 7 を補完。`named_future_period` は補完しない(dates 不明のまま = 従来どおり clarification 継続)。pipeline の AI command 正規化 map(既存の `set_planning_range` 正規化と同じ場所)で適用する。日付計算を AI にさせない(v3 §2-4)。

## 責任境界

- 意味判定(「これは将来 scope の開始発話か」)は AI。窓の算出・値域検証・slot guard・reducer 遷移は deterministic。
- temporal-scope 仕様の「hard apply 禁止」は不変: pending 生成は range を設定せず、開始日は窓内 explicit の検証を経てのみ確定する。

## 触らない範囲

- reducer の `set_pending_planning_range` / `set_planning_range` case(実装済み。変更しない)
- validator の pending 窓内受理分岐(I1 実装。変更しない)
- P3 の範囲(begin intent・planning_period・taxonomy・deterministic gate の scope 語拡充)
- P6 の範囲(confirmed 済み slot の訂正上書き)
- rules モードの deterministic parser 群・legacy fallback・UI・renderer・scheduler・保存/承認・`shouldSavePlan: false`

## 受け入れ条件

日付は既存テスト規約(`planningStartDate: '2026-07-10'` 金曜 / `currentDateTime: '2026-07-10T15:30:00'`)。

1. **A**: system prompt に「weekday answers are resolved by the deterministic parser」を含む旧行が存在せず、pending 窓内での曜日→ISO 日付解決を指示する新行が存在する(文字列テスト)。
2. **B**: provider 経路で「来週の計画を立てたい」に stub が `set_pending_planning_range`(kind: next_week, label: 来週, dates なし)を返すと、正規化により `state.pendingPlanningRange` が `startDate: '2026-07-13'` / `endDate: '2026-07-19'` / `durationDays: 7` で保存され、missing に `planning_start_date` が入り、decision が `ask_planning_start_date` になる。
3. **A+B 連結(複数 turn)**: 条件2の state から次 turn で stub が窓内 explicit `set_planning_range`(2026-07-15 開始)を返すと accepted で適用され、pending が解消される(I1 の既存テストと接続した2 turn シナリオ)。
4. `named_future_period`(label: 夏休み・dates なし)は dates 未補完のまま保存され、その後の explicit range は窓不明のため acceptedWithConfirmation に倒れる(既存分岐の維持確認)。
5. range 確定済み state への `set_pending_planning_range` は `confirmed-slot-overwrite` で reject される。
6. shape/enum/値域の不正 payload(kind 不正・label 欠落・不正日付・durationDays 0)が reject される。
7. rules モードの挙動が不変(既存テスト無変更 green)。
8. `npm run build` 成功。

## テスト観点

- foundation: prompt 文字列(A の新旧行)、validator の shape/enum/値域/slot、adapter 正規化の単体(next_week 補完・named 非補完・durationDays 既定・週境界: currentDateTime が日曜/月曜のケース)。
- pipeline: 受け入れ条件2〜5 の統合(stub)。
- regression: I1 の窓内受理テスト・rules モード全域・P1/P2 の decision。

## リスク

- A・B とも実 AI の準拠は stub テストでは保証できない。**real-eval(`weeklyPlanningAiInterpreter.real-eval.test.ts`)へ「来週の計画を立てたい」→「水曜日から」の2 turn ケースを追加して1回評価することを強く推奨**(本タスクの受け入れ条件には含めない。報告に実施可否を明記)。
- 翌週窓の算式は既存 `nextWeekScope`(`startOfWeek` 基準)と一致させること。独自実装で週開始日がずれると deterministic(rules)経路との意味が割れる。既存関数の export 再利用を第一候補とする。
- `commandSlotKeys` への `planning_range` 追加により、AI が同一応答で `set_pending_planning_range` と `set_planning_range` を両方返した場合は slot 競合解決(confidence 順)が働く。意図的な仕様として報告に明記する。

## Codexへの実装指示

1. 本md・`docs/ai/codex-task-guide.md`・親設計 v3 §2〜§3・I1 md を読む。
2. 実装順: A(prompt)→ B schema/validator → B 正規化(adapter + pipeline map)→ テスト。
3. 参照: `toPlanningRangeFromSetPlanningRangeCommand`(正規化の前例・T3)、`nextWeekScope`(窓算式)、validator の pending 窓内分岐(I1)。
4. 検証(Node 22):

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```

5. `docs/ai/codex-task-guide.md` に従う: スコープ外へ広げない、git 操作をしない、受け入れ条件のチェック結果・real-eval 実施可否・解釈で埋めた点を報告する。
