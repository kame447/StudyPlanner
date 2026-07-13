# 対話P4(旧Stage3): 非 exam の学習目標を command として受理し、legacy fallback から保護する

> **ステータス: superseded（未完了を closed とみなさない）。** 親設計 v4 は本 task を今後の独立 stage として扱わない。現在作業ツリーに本 task 由来と見られる差分があるため、ここで完了扱いにしてはならない。所有者が既存の受け入れ条件を検証してから履歴化する。新規実装の正は v4 の DA0〜DA3c queue（本 task は superseded）。

> **改訂 2026-07-11(親設計 v2 対応)**: v2(draft-first)では、学習目標は preview 生成の **blocking slot を解消する中心語彙**として位置づけが上がる。本タスクの機構(set_study_goal / fallback 保護)は不変だが、目標受理後の接続先が変わる: v1 では「次の質問へ進む」だったが、v2 では **P5(非 exam preview bridge)完了後は暫定量つきの初回 preview へ進む**。P5 完了までは `explain_capability_gap`(P3)が正直な応答を担う。
>
> **再改訂 2026-07-11(親設計 v3 対応)**: 本タスクは元々「AI 経由のみで emit・deterministic の目標抽出 regex を追加しない」設計であり、v3(AI 単一解釈)とそのまま整合する。変更点は前提順序のみ: **I1・I2 → P3 → 本タスク(P4)**。受け入れ条件 2 の rules モード検証(legacy fallback の偽タスク置換ガード)は従来どおり有効。
>
> **追補 2026-07-13(P3 監査対応)**: I1・I2・I1追修正・P3 は実装・監査済み(closed)。P3 監査で「`planning_period` が未確定のまま preview 用に既定期間へ fallback する場合、`PlanningAssumption` が記録されない(唯一の暗黙仮定)」という取りこぼしが確認されたため、**最小の追跡追加を本タスクの範囲に含める**(「修正方針」5・受け入れ条件 9〜10)。goal acceptance の本来責務は拡大しない。

Priority: **Medium**(理由: 実測事例「数学のテスト勉強したい」「テスト勉強はゴールでしょ？」の核心だが、legacy fallback(R1 regression 固定領域)に guard を入れるため、先行 stage の検証後に段階投入するのが安全。影響の大きさより投入順序を優先して Medium とする)

本mdの範囲外へ進まない。git add / commit / push はしない。

**前提**: 親設計 v2 §7 の P4。**P3(entry intent + taxonomy)完了が前提**(目標受理後の「非 exam は候補生成未対応」応答を `explain_capability_gap` が担うため)。S1(grounding・実装済み)が訂正発話の anchor を供給する。backlog D1・D2(`docs/ai/strategy/weekly-planning-deferred-backlog.md`)の会話レベル部分を本タスクが先行消化し、preview までの接続は P5 が担う。着手時に実コードが本mdと食い違えば実装せず報告する。

## 背景

実測(2026-07-10)で「数学のテスト勉強したい。予定はカレンダーと時間割の予定ぐらいかな」が tasks=[]・scope=undefined のまま catch-all に落ち、続く訂正「テスト勉強はゴールでしょ？」も解釈されないことを確認した。原因: **「学習目標を述べた」を受理する command が deterministic にも AI schema にも存在しない**。`state.tasks`(`StudyTaskScope[]`)へ書ける経路は legacy fallback(`looksLikeWeeklyPlanningRequest` = 週語+N時間×2 gate)のみで、しかも fallback branch B は非 exam の weekly intent で**毎ターン sourceTurns 全体を再解釈して tasks を丸ごと置換**するため(実測: 「食事は各30分です」から偽タスク「食事は各です」を生成)、command で書いた tasks を後続ターンで破壊する構造がある。

## 目的

「〜を勉強したい/やりたい」という学習目標を意味カテゴリ(`set_study_goal`)として受理し、`tasks_or_goals` を充足して対話を前進させる。command で受理した目標は legacy fallback による置換から保護する。候補生成(scheduling)の非 exam 対応は行わない(R3 の範囲。目標受理後に条件が揃った場合は Stage 2 の `explain_capability_gap` が正直に応答する)。

## 計画書との対応

- spec: §5(「計算理論と英語を進めたい」だけの発話からタスク候補を整理する)、§12(タスク候補抽出 = LLM の担当)
- 改善テーマ: 親設計 §5.1 / dialogue-design-review W4 / backlog D1(fallback 縮小の前提条件)・D2(会話レベルの先行分)/ roadmap R3 の準備

## 対象ファイル

- 変更:
  - `src/features/weeklyPlanning/intake/weeklyPlanningCommandTypes.ts`(`set_study_goal`)
  - `src/features/weeklyPlanning/intake/weeklyPlanningCommandAdapter.ts`(payload → `StudyTaskScope` 変換)
  - `src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts`(command case)
  - `src/features/weeklyPlanning/intake/weeklyPlanningIntakeTypes.ts`(`tasksSource?: 'command' | 'legacy_fallback'` の optional 追加)
  - `src/features/weeklyPlanning/intake/weeklyPlanningLegacyFallback.ts`(command 保護 guard)
  - `src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts`(KNOWN_COMMAND_TYPES / shape / 値域)
  - `src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts`(schema + prompt bullet)
  - `src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts`(acceptedFacts への目標反映)
  - `src/features/weeklyPlanning/intake/weeklyPlanningDraftRequestAdapter.ts`(planning_period 仮定の記録 — 「修正方針」5)
- 新規: なし
- テスト:
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts`
  - `src/features/weeklyPlanning/__tests__/weeklyPlanningLegacyFallback.test.ts`(保護 guard の regression 追加)
  - `src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts`(validator)
  - `src/features/weeklyPlanning/__tests__/weeklyPlanningDraftRequestAdapter.test.ts`(planning_period 仮定の記録)

## 現在の処理経路

1. `StudyTaskScope`(title / subject / unit / amount / rawText / requiresTimeEstimate)は既存の state.tasks 要素型。書き込みは legacy fallback の `toPlanningTasks` のみ。
2. fallback branch A(初回判定): `intent === 'unknown' && looksLikeWeeklyPlanningRequest(userText)`。branch B(revision merge): `previousState truthy && intent === 'weekly_study_planning'` で、`mergeWeeklyPlanningRevision(sourceTurns 全結合 + 今回発話)` の結果 tasks が非空かつ `!state.examPrepScope` なら **tasks を丸ごと置換**(`applyRevisionMergeFallback`)。
3. `resolveStatus` は `tasks.length > 0 || examPrepScope` で draft_ready 判定。`createWeeklyDraftRequestFromIntakeState` は exam 専用条件で null(非 exam は D2)。
4. AI schema に目標系 command は無い。「数学のテスト勉強」は `hasExamScopeSignal`(院試/分野/年度範囲/第N部/N年分)にも一致しない。

## 問題点

- 学習目標の意味カテゴリ欠落(W4)。ユーザーが何度言い換えても、訂正しても、tasks_or_goals を充足する手段が無い。
- fallback branch B の全置換が、command 由来 tasks の保護なしに走る(D1)。このまま `set_study_goal` を足すと、次のターンの雑談・制約回答で目標が偽タスクに置換され得る。

## 修正方針

### 1. `set_study_goal` command(semantic intent)

```text
type: 'set_study_goal'
goal: {
  title: string            # 例: 「数学のテスト勉強」
  subject?: string         # 例: 「数学」
  unit?: StudyScopeUnit    # 省略時 'unknown'
  amount?: number          # 明示があるときのみ(「10時間」→ unit: 'hours', amount: 10 等)
}
sourceText / sourceSegment / confidence
```

- **AI 経由のみで emit する**(deterministic の目標抽出 regex は追加しない — 自然文からの抽出は spec §12 で LLM の担当であり、regex 追加は W7 の再生産になる。deterministic 側の受理は既存 legacy fallback の担当のまま)。
- schema / `KNOWN_COMMAND_TYPES` / `hasRequiredShape`(title 必須・非空文字列)/ `validateValueRange`(amount は正の有限数、unit は `STUDY_SCOPE_UNITS`)を追加。prompt bullet: 「ユーザーが学習したい内容・目標を述べたら emit(院試の年度×分野 scope は従来どおり set_exam_scope)。amount を捏造しない」。
- `commandSlotKeys` には**追加しない**(tasks_or_goals を confirmedSlots で占有すると言い直し・上書きができなくなる。上書き規則の形式化は Stage 4 の correction envelope で行う)。

### 2. reducer / adapter

- adapter: `toStudyTaskScopeFromSetStudyGoalCommand` — `unit` 省略時 `'unknown'`、`requiresTimeEstimate` は「amount が無い、または unit が時間系(`minutes`/`hours`)でない」とき true。`rawText` は sourceSegment ?? sourceText。
- reducer `case 'set_study_goal'`:
  - tasks へ **title で upsert**(同 title は置換、異 title は追加)。
  - `intent` が `unknown` なら `weekly_study_planning`。
  - `missing` から `tasks_or_goals` を remove。
  - `tasksSource: 'command'` を設定。
- `applyWeeklyPlanningUserTurnWithDiagnostics` の turn 冒頭 state コピーはスカラー spread で `tasksSource` を引き継ぐ(明示コピー不要なことを確認)。

### 3. legacy fallback の保護 guard(D1 の部分消化)

- `applyLegacyWeeklyPlanningFallback`: `state.tasksSource === 'command'` のとき branch A / branch B とも**適用しない**(early return)。
- legacy 経路で tasks が書かれた場合は `tasksSource: 'legacy_fallback'` を設定(branch A / B の適用箇所)。未設定(過去 state)は従来どおり fallback 対象 = 後方互換。
- fallback の判定式そのもの(`looksLikeWeeklyPlanningRequest` / intent 条件)は変更しない。

### 4. renderer の受理反映

- `createDialogueRenderInput` の `acceptedFacts` に `goals?: string[]`(tasks の title、`tasksSource === 'command'` のときのみ)を追加し、`formatAcceptedFacts` に「目標は◯◯」を追加。AI renderer prompt への項目追加は不要(acceptedFacts は既に汎用で渡っている)。

### 5. planning_period 仮定の追跡(P3 監査対応・最小)

- `createAssumedWeeklyDraftRequest`(`weeklyPlanningDraftRequestAdapter.ts`)で、**`planning_period` が `state.missing` に残ったまま合成する場合**、`PlanningAssumption { slot: 'planning_period', source: 'default', description: '期間の指定がないため、既定の期間(選択中の開始日から7日間)で仮の計画を作ります。' }` 相当を assumptions に追加する。
- **記録のみ**とする: 合成の成否条件・scheduling の値(`input.planningStartDate` / `planningDayCount` への fallback)は一切変えない。description に具体日付を含める必要はない(含めるために context を拡張しない)。
- `planning_period` が missing でない場合(range 確定・pending 化・そもそも seed されていない)には記録しない — 確定済み期間と仮定期間が assumptions の有無で区別できることが目的。
- summary への表示は P2 実装済みの assumptions 経路に自動で乗るため、decision / renderer / messages 側の変更はしない(P5 の renderer 一般化・preview policy 全体の変更を先取りしない)。

## 責任境界

- 自然文からの目標**抽出**は AI。**受理可否**(shape / 値域)は validator。**state への反映**(upsert / missing 解消 / intent)は reducer。deterministic 側に目標抽出の自然言語処理を追加しない。
- scheduling は不変: 非 exam tasks は draft request にならない(R3 まで)。その状態の**説明責任**は Stage 2 の `explain_capability_gap` にある(本タスクで文言は触らない)。

## 触らない範囲

- `looksLikeWeeklyPlanningRequest` の判定式・`weeklyPlanningTransforms.ts` の抽出ロジック本体
- `createWeeklyDraftRequestFromIntakeState` / remaining work items / scheduler(R3)
- decision taxonomy(Stage 2 実装済み前提。変更しない)
- 訂正 envelope(correctsSlot 等)の導入(Stage 4)
- exam prep フロー(set_exam_scope 系)の挙動
- `shouldSavePlan: false` を維持する

## 受け入れ条件

1. stub interpreter が `set_study_goal({ title: '数学のテスト勉強', subject: '数学' }, high)` を返すと、`state.tasks` に該当 `StudyTaskScope` が入り、`tasks_or_goals` が missing から消え、intent が `weekly_study_planning` になる。
2. 上記の後のターンで「睡眠は23時から6時、食事は各30分です」(legacy fallback が偽タスクを作る実測入力)を rules モードで適用しても、**tasks が置換されない**(`tasksSource === 'command'` guard)。
3. 同 title の `set_study_goal` 再受理で tasks が重複しない(upsert)。異 title は追加される。
4. legacy 専用フロー(「来週、英語を3時間、数学を2時間」→「あと物理を2時間」)の既存テストが**無変更で green**(guard は command 由来のときのみ働く)。
5. stub で目標受理後、`createDialogueRenderInput` の acceptedFacts に目標 title が含まれ、deterministic レンダリングの受理サマリに「目標」が現れる。
6. 訂正シナリオ(統合): 「数学のテスト勉強したい。…」で stub が空を返し catch(Stage 2 の open/ask 応答)→ 次ターン「テスト勉強はゴールでしょ？」で stub が `set_study_goal` を返す → tasks 受理・以後 tasks_or_goals を再質問しない(contract 3・5 の state 側)。
7. validator: title 欠落 / 空 title / 不正 unit / 負の amount が reject される。
8. 既存テスト全 green + `npm run build` 成功。
9. **planning_period 仮定の記録**: `planning_period` が missing のまま合成可能な state(例: begin で seed され期間未回答・exam scope と totalYears あり)で、`createAssumedWeeklyDraftRequest` の戻り値 assumptions に `slot: 'planning_period'` のエントリが含まれ、pipeline output(`assumedDraft.assumptions`)経由で decision summary に乗る。
10. **確定期間との区別**: range 確定済み・pending 化済み・planning_period 未 seed のいずれの state でも `slot: 'planning_period'` の assumption が記録されない。合成の成否・候補の配置結果は本追加の前後で不変。

## テスト観点

- interpreterFoundation: shape / 値域 / KNOWN_COMMAND_TYPES。
- pipeline: 受け入れ条件 1・2・3・6(複数ターン)。
- legacyFallback.test: 受け入れ条件 2・4(command 保護 + legacy 無変更の両面固定)。
- draftRequestAdapter.test: 受け入れ条件 9・10(planning_period missing の有無 × 記録の有無。既存 assumptions(year_range / unit_duration_estimate 等)への影響が無いこと)。
- 境界: exam scope と目標の同居(院試 scope がある state に set_study_goal が来た場合 — tasks に追加されるが exam フローの draft 条件は examPrepScope 側で従来どおり。既存 exam テストが green のままであることで担保)。

## リスク

- fallback guard により、「目標を command で受理した後、legacy 形式の追加発話(あと物理を2時間)」が tasks に反映されなくなる。これは意図した変更(混在経路の同時書き込みを禁止)であり、AI 側 `set_study_goal` が同発話を拾う想定。ただし rules モード(AI 無効)では拾えないため、rules モードの非 exam フローは従来どおり legacy 経路に任せる(guard は tasksSource==='command' のときのみ)。この非対称は報告に明記する。
- `tasksSource` の後方互換: 既存の保存された intake state は存在しない(会話 state は非永続)ため migration 不要。
- AI が amount を捏造するリスク → prompt で禁止 + 値域検証 + requiresTimeEstimate の既定 true 側。

## Codexへの実装指示

1. 最初に本md全体と `docs/ai/codex-task-guide.md`、親設計 §5・§6 を読む。
2. Stage 2 の実装(explain_capability_gap / open_planning_dialogue)が存在することを確認する。無ければ実装せず報告する。
3. 実装順: 型 → adapter → reducer → fallback guard → validator/schema → renderer 反映 → planning_period 仮定の記録(方針5・独立変更)→ テスト。
4. 参照すべき既存実装: `toPlanningTasks`(legacy の StudyTaskScope 生成)、`applyMarkCompletedUnitsCommand`(upsert パターン)、`use_constraint_source`(AI 経由 semantic intent の追加様式)。
5. 検証(Node 22):

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/__tests__/weeklyPlanningLegacyFallback.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```

6. `docs/ai/codex-task-guide.md` に従う: スコープ外へ広げない、git 操作をしない、受け入れ条件のチェック結果・rules モード非対称の扱いを報告する。
