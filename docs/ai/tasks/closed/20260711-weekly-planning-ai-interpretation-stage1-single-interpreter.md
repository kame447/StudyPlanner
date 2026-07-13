# AI解釈Stage1: 意味解釈を AI interpreter に一本化する(escalation 廃止・provider 時毎 turn 解釈)

Priority: **High**(理由: 実会話で確認された「複合発話の一部だけが deterministic に拾われ、AI が発話全体を見る機会を失い、既出情報を再質問する」構造の直接原因。親設計 v3 の中核であり、これが入るまで会話品質の他の改善が構造的に頭打ちになる)

本mdの範囲外へ進まない。git add / commit / push はしない。

**前提**: 親設計 `docs/architecture/weekly-planning-dialogue-architecture.md`(v3)§1〜§3。P1(仮定合成)・P2(preview-first)コミット済み(`6803dbd` / `28f4726`)。着手時に実コードが本mdと食い違えば実装せず報告する。

## 背景(実会話・実コードで確認)

「今日明日の計画を立てたい / やることは院試の過去問で、ハードウェア分野を主にやる / 年度は2024~2019」に対し、deterministic の `set_exam_scope` が成立したことで `shouldEscalateToInterpreter` が AI 呼び出しを抑制し(madeProgress + missingBefore 空)、「ハードウェア分野を主にやる」という優先意図が失われて後から再質問された。次 turn「だいたい3時間くらい」も `parseBareDurationAsUnitRateCommand` の短絡で AI 抑制。現構造は「deterministic 先行 + 失敗時のみ AI」の並列解釈であり、複合発話・言い換え・省略・訂正で系統的に情報を落とす。個別 regex の追加では直さない(親設計 v3 §1)。

## 目的

provider 利用可能時、**毎 user turn を AI interpreter が解釈する唯一の意味解釈器**にする。deterministic parser 群は provider 時には意味解釈に関与せず、normalization / validation / rules モード fallback に役割を限定する。

## 計画書との対応

- spec: §12(自然文からの抽出 = LLM の担当を文字通り実装する)
- 改善テーマ: 親設計 v3 §2-1・§3 / capability model §1.1(同一 command 空間を共有する二重 classifier の解消)

## 対象ファイル

- 変更:
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts`(`runWeeklyPlanningIntakePipelineWithInterpreter` の再構成)
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningInterpreterEscalation.ts`(廃止。ファイル削除 or 明示 deprecation — 参照が無くなるなら削除)
  - `src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts`(「解釈なし turn 適用」の提供 — 下記方針2)
  - `src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts`(pending 窓内 explicit range の受理 — 下記方針4)
  - `src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts`(system prompt: 毎 turn 解釈前提の明確化。複合発話から**すべての**意図を candidates 化する指示)
- 新規: なし
- テスト:
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts`
  - `src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts`

## 現在の処理経路(要点)

1. `runWeeklyPlanningIntakePipelineWithInterpreter`: deterministic turn(`applyWeeklyPlanningUserTurnWithDiagnostics` = setup parse + turn parse + legacy fallback + finalize)→ `shouldEscalateToInterpreter` が false なら **AI を呼ばず終了**。true のときだけ AI 解釈 → validator → `applyWeeklyPlanningCommands` を deterministic 適用済み state の上に重ねる(= merge)。
2. `shouldEscalateToInterpreter` の抑制条件: bare-duration 短絡 / madeProgress + missing 減 / madeProgress + missingBefore 空。
3. validator の pending guard(T3): pending 中の AI `set_planning_range` は explicit でも acceptedWithConfirmation(適用されない)。現在「水曜日から」の解決は deterministic parse(`parseSetPlanningRangeCommand` + pending)が担っているため成立している。

## 修正方針

### 1. provider 時の経路を一本化する

`runWeeklyPlanningIntakePipelineWithInterpreter` を次の形にする:

```text
provider あり:
  turn 前処理(state clone・sourceTurns 追記・finalize 前提の骨組み)    ← 意味解釈を含まない
  → AI interpretUserTurn(毎 turn・無条件)
  → resolveConstraintSourceReferences → validateInterpretedCandidates
  → applyWeeklyPlanningCommands → assumptions 付与 → finalizeState
  → buildPipelineOutput(P1/P2 の仮定合成・preview-first は不変)
provider なし(rules モード) / AI 呼び出しが例外で失敗した turn:
  従来の deterministic 経路(applyWeeklyPlanningUserTurnWithDiagnostics)をそのまま使う
```

- `shouldEscalateToInterpreter` と bare-duration 短絡は削除する。
- **AI が空 candidates を返した場合は fallback しない**(「この turn に新情報なし」という解釈として尊重。decision 側は P2/P3 の taxonomy が受ける)。fallback は `interpretUserTurn` が **例外**の場合のみ。

### 2. deterministic semantic parse のバイパス

- provider 経路では `parseWeeklyPlanningCommands` / setup parse(range・pending・exam scope)/ progress boundary / legacy fallback を**呼ばない**。reducer に「意味解釈を伴わない turn 開始処理」(state clone + `sourceTurns` 追記 + `questions` リセット + finalize)を切り出す(名称候補: `beginWeeklyPlanningUserTurn`)。既存 `applyWeeklyPlanningUserTurnWithDiagnostics` は rules 経路用にそのまま残す(変更しない)。
- clarification 経路(T4 実装済みの「適用後 state に decision 差し替え」)は AI 経路の一部としてそのまま生きる。

### 3. AI prompt の更新(最小)

- 「毎 turn 呼ばれる」「発話に含まれる**すべての**独立した意図を candidates として列挙する(1 発話 = 複数 command 可)」「該当する意図が無ければ空配列」を明記する。
- 既存の安全則(不確実なら command を出さない・confidence 規則・値の捏造禁止)は維持。会話履歴の投入は本タスクではしない(I2)。

### 4. normalization / validator の調整(deterministic 側の受け皿)

- **pending 窓内 explicit range の受理**: pending 中(`stateSummary.pendingPlanningRange` あり)の AI `set_planning_range` について、`range.confidence === 'explicit'` かつ開始日が pending scope の `startDate`〜`endDate` 窓内なら **accepted に変更**(現在は無条件で acceptedWithConfirmation)。窓外 explicit は従来どおり確認へ、非 explicit は reject のまま。これは「水曜日から」の曜日→日付解決が deterministic parse から AI + 窓内検証へ移ることへの対応であり、hard-apply 禁止原則は「窓内検証済みのみ受理」という deterministic guard に置き換わる。
- 既存の explicit range guard(reducer)・confirmedSlots・値域検証は不変。

### 5. 凍結宣言

- deterministic semantic parser 群(scope / priority / completion / unit rate / constraint / unavailable / uncertainty / range 意味判定)への**新規パターン追加を凍結**する(rules fallback の現状維持のみ)。本タスクでコードは削除しない(rules 経路が使う)。

## 責任境界

- 意味解釈: AI のみ(provider 時)。deterministic は turn 骨組み・normalization・validation・reducer guard・dialogue policy。
- AI 出力の適用可否は従来どおり validator が最終判定(本タスクで防衛線を緩めるのは pending 窓内 explicit の1点のみで、それも deterministic 検証付き)。
- rules モードの挙動は一切変えない。

## 触らない範囲

- deterministic parser 群のコード本体(削除・縮小は行わない。呼び出し経路の切替のみ)
- P1/P2 の仮定合成・preview-first decision・dialogue taxonomy
- renderer(AI/deterministic とも)・UI・scheduler・保存/承認・`shouldSavePlan: false`
- 会話履歴の供給(I2)

## 受け入れ条件

すべて stub interpreter + 既存テスト規約の日付で検証する。

1. provider 経路で、deterministic parser が確実に拾える発話(例: 「来週の計画を立てたい」)でも **AI が毎 turn 呼ばれる**(stub の呼び出し回数で検証)。
2. §1 の実会話 turn 1 相当: stub が `set_exam_scope` + `set_priority_policy(field_first: ハードウェア先頭)` を返すと**両方が適用**され、後続 decision が priority を再質問しない。
3. turn 2「だいたい3時間くらい」相当でも stub が呼ばれる(bare-duration 短絡の削除)。stub が `set_unit_rate` を返せば適用される。
4. pending 中(「来週の計画を立てたい」適用後)に stub が窓内 explicit `set_planning_range`(2026-07-15 開始)を返すと **accepted で適用**され、pending が解消される。窓外 explicit は acceptedWithConfirmation、inferred は reject(既存)。
5. stub が例外を投げた turn は deterministic 経路で処理される(rules 相当の結果)。stub が空 candidates を返した turn は state が進まず、P2 の decision(preview / 質問 / open)が返る。
6. rules モード(interpreter なし)の全既存テストが**無変更で green**。
7. provider 経路の既存テストのうち escalation 抑制を前提にしたものは、意図した変更として期待値を更新し理由を報告する(deterministic 併走を前提にした「deterministic + AI の合算適用」ケースは AI 単独解釈の期待値へ書き換え)。
8. `npm run build` 成功。

## テスト観点

- 呼び出し契約(毎 turn / 例外 fallback / 空尊重)。
- 複合発話の複数 command 適用(契約11)。
- pending 窓内受理の境界(窓の初日・最終日・窓外・非 explicit)。
- regression: rules モード全域、P1/P2 の decision 優先順、T4 の clarification 直交化、T1〜T3 guard。

## リスク

- 従来 deterministic が拾っていたパターンの解釈品質が実 AI に依存するようになる。防衛線(validator/guard)は維持されるため誤適用は防げるが、**取りこぼし**は起こり得る。緩和: (a) 既存 real-eval(`weeklyPlanningAiInterpreter.real-eval.test.ts`)へ §1 の実会話と主要 deterministic パターン(「水曜日から」「1年分は3時間」「日曜の13時から歯医者」等)を追加して1回評価する(本タスクの完了条件には含めない。報告に推奨として記載)。(b) 例外時 fallback により全断は避けられる。
- interpreter 呼び出し増によるコスト・レイテンシ増は v3 §5 で確定済みの製品判断。
- 「解釈なし turn 開始処理」の切り出しで sourceTurns / questions リセット等の複製漏れに注意(既存 clone 処理を共通化して使う)。

## Codexへの実装指示

1. 本md・`docs/ai/codex-task-guide.md`・親設計 v3 §1〜§6 を読む。
2. 実装順: reducer の turn 骨組み切り出し → pipeline 一本化(escalation 削除)→ validator 窓内受理 → prompt 更新 → テスト。
3. 参照: `runWeeklyPlanningIntakePipelineWithInterpreter` の現行 clarification/適用列(T4 実装)、validator の pending guard(T3 実装)、`applyWeeklyPlanningUserTurnWithDiagnostics` の state clone。
4. 検証(Node 22): `npm run test:run -- src/features/weeklyPlanning` / `npm run build` / `git diff --check && git diff --stat && git status -sb`。
5. `docs/ai/codex-task-guide.md` に従い、期待値を更新した既存テストを理由つきで報告する。
