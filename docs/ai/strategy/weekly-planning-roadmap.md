# weeklyPlanning 改善ロードマップ

この文書は、`docs/weekly-planning/weekly-planning-spec.md`(以下 spec)の理想仕様と現実装の差分をもとに、weeklyPlanning 機能の改善順序・優先度・リスク・今やらないことを定める上位計画である。

**この文書は Codex に直接実装させるタスクmdではない。** 方向性と優先順位を決める文書であり、ここから Claude/Fable が `docs/ai/tasks/*.md`(Codex が1回で潰せる実装単位)を切り出す。

- 作成日: 2026-07-02 / 最終更新: 2026-07-04(R1 クローズ、R2 初期スコープ追加)
- 実コード基準: R1 完了・main マージ後(完了監査は `docs/ai/tasks/closed/20260703-weekly-planning-r1-completion-report.md`)
- 古い設計文書と実コードが食い違う場合は実コードを優先する。`set_exam_scope` / `set_planning_range` は Phase 9.7 で command path 移行済み。

## 0. 運用循環

今後の基本運用は次の循環とする。

```text
1. 全体計画md(この roadmap)を作る・更新する
2. roadmap から、Codex が1回で潰せるタスクmdを1本切る(docs/ai/tasks/*.md)
3. Codex がそのタスクmdを読み、書かれた範囲だけを実装する
4. ユーザーが確認・承認する
5. 完了したタスクmdを docs/ai/tasks/closed/ へ移す
6. 次のタスクmdを切る(必要なら roadmap を先に更新する)
```

文書の役割を混同しない。

| 場所 | 役割 |
| --- | --- |
| `docs/ai/strategy/weekly-planning-roadmap.md` | 方向性と優先順位を決める上位計画。Codex には渡さない。 |
| `docs/ai/tasks/*.md` | Codex に渡す実装単位。`docs/ai/task-brief-template.md` の形式に従う。原則、同時にオープンなタスクは少数(理想は1本)に保つ。 |
| `docs/ai/tasks/closed/*.md` | 実装済み・承認済みタスクの記録。移動のみで内容は書き換えない。 |

タスクmdの書き方は `docs/ai/task-brief-template.md`、Codex 側のルールは `docs/ai/codex-task-guide.md`、責務境界の規範は `docs/ai/weekly-planning-pipeline-guide.md` §3 に従う。

## 1. 現在地

> **2026-07-04 更新**: 本節は R1 着手前(2026-07-02 時点)の記録である。R1 の到達点は §3 Phase R1 のクローズ記録と completion report を参照。R1 マージ後の実使用で見つかった課題は §3「Phase R2 初期」にまとめた。

実コードで確認した実装状況(2026-07-02 時点)。

### intake pipeline

`userText → applyWeeklyPlanningUserTurn → PlanningIntakeState → draft request → remaining work items → dry-run candidates → preview` の会話型パイプラインが `pipeline/weeklyPlanningIntakePipeline.ts` で動いている。missing / ambiguity 管理(`weeklyPlanningMissingStatus.ts`)、dialogue decision(`dialogue/weeklyPlanningDialogueManager.ts`)、`shouldSavePlan: false` の維持も実装済み。

### command boundary

`intake/weeklyPlanningCommandTypes.ts` に 9 command が定義され、parser → command → adapter → reducer の境界がほぼ完成している: `add_unavailable`, `add_fixed_event`, `update_life_constraint`, `set_priority_policy`, `mark_completed_units`, `set_unit_rate`, `set_exam_scope`, `set_planning_range`, `note_progress_boundary`(曖昧進捗ヒント。直近のタスクで command 化)。

reducer(`weeklyPlanningIntakeReducer.ts`)に残る parser 的責務は次の2つだけになった。

- uncertainty 判定の正規表現(`知らない分野.*時間かかる|細かく見る.*時間かかる`)の直書き
- legacy fallback: intent 未確定時の `looksLikeWeeklyPlanningRequest` → `assessWeeklyPlanningRequest`、revision 時の `mergeWeeklyPlanningRevision`(`TODO(Phase 9.8)` として隔離中)

### draft candidate generation

新 intake path の dry-run generator(`scheduling/weeklyDraftCandidateGenerator.ts`)が、constraints / fixedEvents を busy interval 化して slot 探索前に避け、決定的な候補と diagnostics(unscheduled items、conflicts、decisionTrace)を返す。session chunking、date-less unavailable の planning days 展開(`weeklyPlanningConstraintScheduling.ts`)も実装済み。

ただしパイプライン全体が **exam prep 専用**である。`WeeklyPlanningDraftRequest` は `yearRange` + `field_first` priority + `year_field_chunk` unitRate が揃わないと null を返し、`WeeklyPlanningRemainingWorkItem` は `field × year` 固定。

旧 availability-aware path(`weeklyPlanningTransforms.ts`, `scheduling/availabilitySlots.ts`, `placementScoring.ts`)が併存しており、slot 探索モデルは共有されていない。

### 仮予定表示と承認保存導線

preview blocks → 未承認 `WeeklyPlanDraftBlock` への昇格 → 週/日表示での表示 → 一括承認で `createPlanDraftFromWeeklyDraftBlock` → `savePlanDraft` → draft block 除去、という導線が実装済み。localStorage は pending draft blocks のみを保持する。自動保存はない。

### テスト状況

edge cases(約700行)、roleplay シナリオ、persona 入力、pipeline 統合、generator、placement property テストなどが存在する。一方で次が弱い。

- reducer 経由で legacy fallback を通る入力の regression set(fallback 関数の直接テストはあるが、経路の spec 化が不十分)
- `constraintToBusyInterval` の暗黙推定(meal の end−60分既定など)の明文化テスト
- spec の章を系統立ててカバーする構成になっていない(どの章がテスト済みかの対応が取れない)

## 2. 理想仕様との差分

spec にあるが現実装で未対応・弱い箇所。観点別に整理する。

| 観点 | spec | 現状 | 差分の大きさ |
| --- | --- | --- | --- |
| 自然言語入力処理 | §5: 範囲・締切・完了条件・分割単位・順序制約を聞き取る | 過去問年度・unavailable・fixed event・priority・unit rate 中心。締切・完了条件・ページ/語数/問題番号は未対応 | 大 |
| メンター対話型ヒアリング | §5: 不足情報だけを少しずつ、選択肢つきで聞く | missing 起点の質問は出るが、選択肢提示・「分からない」の有効回答化・仮置きへの倒し込みは未実装 | 大 |
| 質問しすぎ防止 | §6: 質問するべき度 = 影響×不確実性−コスト、1ターン1〜3問 | `finalizeState` が missing 全件分の質問を一括生成。質問数・優先度の policy 層がない | 大 |
| 生活プロファイル | §4: 睡眠・食事・バッファをメモリ保持し、次回は仮置き+まとめ承認 | constraints は会話 state 限り。セッションを跨ぐ保持なし | 大(要設計判断) |
| タスク分割・所要時間推定 | §5, §7: 教材タイプ別の分割単位、見積もり補正 | `year_field_chunk` 固定。`profiling/` にタスク特性推定はあるが intake と未接続 | 大 |
| 進捗記録 | §8: 実施時間+タスク全体の進捗位置を記録 | 未実装 | 大 |
| 再計画 | §11: トリガー判定と再配置、削除理由の選択式ヒアリング | 未実装 | 大 |
| 仮予定承認 | §10: 週/日表示に仮表示、承認後に確定 | ほぼ実装済み(表示・昇格・一括承認・破棄・個別削除)。ドラッグ調整と userEdited 保護は今後 | 小 |
| LLM使用量削減の責務分離 | §12: 抽出系だけ LLM、計算系はコード | 現状は全経路が決定的コード。command boundary が LLM 接続点として確保済み(`WeeklyPlanningIntakeInterpreter` の TODO boundary あり)。LLM 導入自体は未着手 | 中(構造は良好) |

構造面の差分(spec には直接書かれていないが理想到達に必要):

- reducer に uncertainty 正規表現と legacy fallback が残る(command boundary 未完成の最後の2箇所)
- scheduler が二系統あり、busy interval / availability の型が揃っていない
- 進捗単位が `exam_year` 固定で、責務分離文書 §9 の `TaskProgressScope` / `unitKind` 一般化が未着手

## 3. 改善フェーズ

今後の改善を Phase R1〜R8 に分ける(実装履歴の Phase 9.x 番号と衝突しないよう R 系で振る)。**Phase は複数タスクを束ねる上位方針であり、Codex に直接渡す単位ではない。** 各 Phase の「タスク分解例」が `docs/ai/tasks/*.md` 1本の粒度の目安である。

### Phase R1: command boundary の完成と reducer 薄化【クローズ済み 2026-07-04】

**R1 はクローズ済み。** 達成済みとみなす範囲: 週間計画MVPの基本導線、通常入力との分離、command boundary の整理(reducer からの自然言語解釈の排除、legacy fallback の単一境界への隔離と regression 固定)、仮予定候補の生成・表示・承認・破棄の基本フロー。R1 の目的は完璧な自然言語対話ではなく、週間計画モードをユーザーが実際に触れる状態にすることだったため、ここで完了扱いとする。完了監査は `docs/ai/tasks/closed/20260703-weekly-planning-r1-completion-report.md`、main マージ済み。fallback の意味論整理(初回/継続ターン定義)は設計案まで作成済みで、実装は R2 以降の設計判断として繰り越し。

以下は R1 実施時の計画(記録として保持)。

- 目的: reducer から自然言語解釈を完全に排除し、すべての入力経路を parser → command → adapter → reducer に統一する。
- spec 対応: §12(責務分離の基盤)
- タスク分解例:
  1. uncertainty 正規表現の command 化(`note_uncertainty` 等。挙動変更なし)
  2. legacy fallback 経路の regression テスト整備(テストのみ。fallback を通る入力・通らない入力の spec 化)
  3. legacy fallback の隔離(fallback 呼び出しを明示的な境界関数へ切り出す。2 の後)
  4. `constraintToBusyInterval` の暗黙推定ルールの明文化テスト(テストのみ)
- 完了条件の目安: reducer が日本語を一切見ない。fallback が単一の境界関数越しになる。

### Phase R2-AI: AI interpreter 基盤と実接続【R2-A/B/C/D 完了・2026-07-07】

- R2-A(interpreter 境界の再設計・candidate validator・escalation)、R2-B(dialogue renderer 基盤・fallback)、R2-C(AI interpreter 実接続・opt-in UI 配線)をすべて実装・コミット済み。candidate 受信契約の一連の修正(confidence 必須化 → schema の anyOf union 完全化 → wrapper 簡素化)も closed。interpreter の実 AI 評価も1回完了(`tasks/closed/20260705-weekly-planning-r2c-eval.md`)。設計記録は `weekly-planning-r2-ai-interpreter-design.md`(実装反映済み)。
- **R2-D(AI dialogue renderer の実接続)完了(2026-07-07・監査で採用可判定)**: structured schema、validation(`sanitizeDialogueRenderOutput` が数・計画外 slot・重複・欠落を全チェックし questionPlan 順に再構成 → AI は各 slot の text のみ変更可)、production injection(`createAiWeeklyPlanningDialogueRenderer` を AI provider 有効時に注入)、failure fallback(parse/型/数/計画外/重複/欠落/call failure すべて部分採用せず deterministic fallback)を実装。「何を聞くか」は questionPlan(deterministic)、「どう言うか」だけ AI。記録は `tasks/closed/20260707-weekly-planning-question-rendering-separation.md`。
- **R2-D 完了条件外(後続改善事項)**: retry policy、prompt tuning、実 AI 品質評価 / golden eval、コスト・レイテンシ計測。renderer の実 AI 評価(実ブラウザスモーク)は R2-C-eval と同様に別途1回行うのが望ましい。
- **監査由来の後続候補(production 未修正)**: (1) `renderWeeklyPlanningDialogueMessage` が質問のないターン(ask_missing_info 以外 / nextQuestions 空)でも `render()` を呼び AI コールを消費する(正しさ影響なし・コストのみ。render 前ガードで削減可)。(2) `fallbackQuestionText` の `meal_bath_constraints` case が targetSlot 写像で到達不能なデッドコード(害なし)。

### Phase R2-S: 実使用スモーク stabilization / correctness【完了・2026-07-07】

実ブラウザの継続対話スモークで見つかった correctness regression と、新 intake path への legacy 不変条件の未移植群。AI 基盤(R2-AI)とは独立に「生成結果の正しさ」を担保した層。**残 open は消化済み。**

- **完了(closed・2026-07-07)**:
  - yearRange 喪失/対象年度の再質問 — `set_exam_scope` apply を scope 置換から merge へ(`97742b0`)
  - 既存予定・時間割の busy interval 除外 — legacy availability 不変条件を新 intake path へ移植(`479f5e8`)
  - 生活制約の全計画日展開 + missing 粒度の kind 単位分離(`79157c4`)
  - sleep end と study available start の分離保持(`5cb7107`)
  - 7日目予備日の新 path 移植(`7b3e288`)— R8 と隣接。6等分・1日上限は R8 へ残す
  - atomic work unit(意味単位を非分割で配置・確認対話は D へ)(`404673c`)— R3/R8 と隣接
  - 仮予定の個別削除導線の復活(UI regression)(`1df831f`)
  - 対話設計: 質問計画 D(`8d695d2`)/ 質問文 E = R2-D(未コミット差分)— R4 の先取り
  - 先行: zero-progress draft、scope parser 誤解釈、no-fixed-events 丁寧形(いずれも closed)
- **R2-S から派生して残る後続候補**(open task 化はしていない・次フェーズ判断待ち):
  - capacity 超過(過去問全量で 100 時間超が計画ウィンドウに収まらない)への 6等分・1日上限配分 — **R8**
  - 既知カレンダー予定の intake 注入と差分提示(staged 候補 b・未着手)/ 分割許可の確認対話(staged 候補 c・未着手)
  - 明示 duration / daily・weekday・weekend target の受理(R2 初期の中タスク)

### Phase R2-Capability: semantic intent ↔ planner capability の橋渡し【新設・2026-07-08】

2026-07-08 の監査(実コード確認)で、R2 の command-candidate architecture(実装済み・有効な中間段階)の次の構造的課題が判明した。設計の正は `docs/architecture/weekly-planning-nl-capability-model.md`、R2 設計メモ §11「Post-R2 architecture evolution」も参照。

- 課題: (1) AI interpreter が決定的 parser と同一の command 空間を共有し、意味解釈層になっていない。(2) `note_no_fixed_events` / `note_uncertainty` 等が発話パターン単位で増えている。(3) 既存予定・timetable を避ける汎用 capability は generator に稼働済みなのに、intake の missing/充足判定と interpreter stateSummary がその存在を知らない(**capability はあるが intake から見えない**)。
- 方針: 全面 GoalIntent 移行はしない。R2 の command 境界の上に、**発話非依存の意味カテゴリ(semantic intent)を最小限だけ**載せ、fixed events / timetable を最初の vertical slice にして `表現ゆれ → semantic interpretation → planner capability resolution → deterministic state/missing → renderer context` を1経路貫通させる。
- 実使用問題の診断原則(A〜F: interpretation / representation / capability / intake 可視性 / state transition / renderer context)を capability model 文書に恒久記録。今後の問題はこの分類で監査する。
- **タスク(依存順)**:
  1. `20260708-weekly-planning-constraint-source-capability.md`(基盤・vertical slice)— capability snapshot の intake/interpreter 可視化 + `use_constraint_source` intent + planner decision による `fixed_events` 充足。**先行必須。**
  2. `20260708-weekly-planning-renderer-deterministic-context.md` — planning period(実例1「来週→今週」回帰防止)と平易語ヒントは基盤に依存せず先行可。利用中 constraint source の表示は基盤(1)完了後。
  3. `20260708-weekly-planning-clarification-semantic-intent.md` — `request_clarification` intent(用語非依存)。基盤(1)の後。
- **破棄**: 旧 `fixed-events-state-and-timetable-intent`(専用状態5値+専用 command の発話追随設計)。実使用問題は上記(1)の背景へ移設。
- **stale**: `completion-target-model` は `CompletionTarget` / `mark_completion_target` / `resolveCompletionTargetMissing` として実装済み。verify のうえ closed へ(本フェーズの対象外)。

### Phase R2 初期: 実使用フィードバック対応(intake 品質改善)【一部反映済み・2026-07-04 記録】

> **2026-07-07 更新**: 本節は R1 マージ直後の初期整理の記録。先行小タスク1(短答 slot filling)は完了・closed。3(年度範囲「から〜まで」)は scope parser 修正で部分対応済み。残る 2(分類分離)・4(トーン改善)は質問文タスク E(`question-rendering-separation`)へ、5/6(明示 duration・target 受理)は atomic / staged 系へ吸収して継続。以下は当時の記録として保持。

- 目的: R1 マージ後の実使用(過去問系入力)で確認された intake の受け入れ条件・slot filling・質問文脈・エラー分類・応答文言の問題を解消する。スケジューラ本体の配置精度の問題ではない。
- 確認された挙動(実ログ由来):
  1. 「過去問を10時間やりたい」「数学の過去問を8時間、英語の過去問を6時間やりたい」のような明示的な total / subject duration があっても、「1年分または1単位あたりの目安時間」を聞き続ける。過去問文脈で `unitModel: 'year_field_chunk'` に固定され、時間指定が無視される(`weeklyPlanningScopeParsing.ts` の `resolveUnitModel`)。
  2. 目安時間を聞いた直後の「3時間です」「3時間」「3時間くらい」が受理されず、同じ質問が繰り返される。`parseUnitRate` が「年分」文脈を要求し、直前に何を聞いたかを使う slot filling がない。
  3. 「過去問を1日五時間やりたい」「毎日3時間」「平日は2時間ずつ」「土日は5時間ずつ」が daily / weekday / weekend target として受理されず、「条件の整合性が取れず」エラーに落ちる。情報不足と条件矛盾の分類が混ざっている。
  4. 「2020年から2025年までの過去問をやりたい」の年度範囲が拾えない。`parseYearRange` が `2020〜2025` / `2020-2025` 形式のみで、「から〜まで」形式は完了年度側 parser(`weeklyPlanningCompletionParsing.ts`)にしかない(移植または共通化を検討)。
  5. 応答文言が事務的で、何が受理され何が不足かが伝わらない(「週間計画に必要な情報がまだ足りません。次に◯◯を教えてください。」「条件の整合性が取れず、仮予定候補を作れませんでした。」)。受理済み条件を表示しつつ、次に必要な情報だけを自然に聞く応答へ変える(spec §13 メンター対話方針)。
- **先行小タスク**(それぞれ1タスクmd。この順を推奨):
  1. 短答 slot filling — 直前に目安時間を聞いた状態(`missing` に `unit_duration_estimate`)なら「3時間です」系を `set_unit_rate` として受理し、同じ質問を繰り返さない。
  2. 情報不足と条件矛盾の分類分離 — dialogueManager の decision kind 判定と文言の対応を直し、情報不足を「整合性が取れず」に落とさない。
  3. 年度範囲「から〜まで」対応 — `parseYearRange` へのパターン追加(完了年度側との共通化を検討)+ exam scope シグナルの見直し。
  4. 受理済み条件の応答反映と文言トーン改善 — ask_missing_info 系の応答に受理済みサマリを足し、文言をメンター調に和らげる(decision summary に素材あり。文言・表示のみでロジックに触れない)。
- **設計が必要な中タスク**(いきなり実装せず、先に小さい設計メモを作ってから分割する):
  5. 明示 duration と過去問文脈の共存 — 「過去問」語で year_field_chunk に固定せず、明示 duration があれば minutes ベースの計画も受理する。state / command / draft request の ready 条件に波及するため設計メモ先行。
  6. daily / weekday / weekend target の受理 — 新 command と state フィールドの追加を伴うため設計メモ先行。
- **回帰テスト(全体計画として担保する項目)**:
  - 「3時間です」が直前質問への回答として受理される。受理後に同じ目安時間質問を繰り返さない。
  - 「過去問を10時間やりたい」が total duration として扱われる。
  - 「数学の過去問を8時間、英語の過去問を6時間やりたい」が科目別 duration として扱われる(「計算理論を4時間、線形代数を5時間」は既存どおり)。
  - 「過去問を1日五時間やりたい」「毎日3時間」「平日は2時間ずつ」「土日は5時間ずつ」が整合性エラーに落ちず、target 条件として受理される。
  - 「2020年から2025年まで」が年度範囲として扱える。
  - 情報不足のケースで「条件の整合性が取れず」という文言に落ちない。

### Phase R2: 自然言語入力の対応範囲拡大【当面の主戦場】

- 目的: spec §5 の聞き取り対象(締切、完了条件、量・単位、順序)を parser + command で拾えるようにする。
- spec 対応: §5、§2
- タスク分解例(表現1群 = 1タスク):
  1. 締切表現(「金曜まで」「来週提出」)の parser + command + missing 連動
  2. 完了条件表現(「全部解けたら完了」「一周したら」)の parser + command
  3. 量・単位表現の拡充(「30ページ」「300語」「20問」を StudyScopeUnit に正しく落とす)
  4. unavailable / fixed event 表現の対応拡充(現 parser の未対応言い回しをテスト起点で追加)
- 前提: R1 と並行可能(parser 層に閉じるため)。ただし単位の一般表現は R3 の型設計と調整する。

### Phase R3: 進捗単位の一般化【exam prep 専用からの脱却】

- 目的: `field × year` 固定を `unitKind`(exam_year / page / word_count / problem_number / report_stage)ベースへ広げ、参考書・単語帳・問題集・レポートを扱えるようにする。責務分離文書 §9 の `TaskProgressScope` 案を実装へ落とす。
- spec 対応: §5(分割単位)、§3(総量配分の入力)
- タスク分解例:
  1. `TaskProgressScope` / `unitKind` の型定義と `ExamPrepScope.yearRange` からの互換変換 helper(挙動変更なし)
  2. remaining work item generator の `unitKind` 対応(exam_year は従来どおり、page を最初の追加対象に)
  3. draft request adapter の exam-prep 専用条件の段階的緩和(unitKind ごとに ready 条件を定義)
  4. `mark_completed_units` / `note_progress_boundary` の unitKind 対応
- 注意: 一度に置換しない。`yearRange` 削除の migration はやらない(互換層で進める)。

### Phase R4: 質問計画(質問しすぎ防止)

- 目的: spec §6 の「質問するべき度」を決定的コードの policy として実装し、1ターンの質問を最大3問に制御する。選択肢提示と「分からない」の有効回答化を dialogue 層に足す。
- spec 対応: §5(選択肢)、§6
- タスク分解例:
  1. 質問候補のスコアリングと上限選択(missing / ambiguity → 優先度つき質問計画。dialogue 層のみ)
  2. 選択肢つき質問の decision 型拡張(messageKey に選択肢 payload を持たせる。UI 変更は含めない)
  3. 「分からない」回答の仮置き化(assumption 化して missing を解除し、最終確認に回す)
- 前提: R1 完了後が安全(missing / ambiguity の発生源が command 経由に統一されてから)。

### Phase R5: 生活プロファイルの保持

- 目的: spec §4 のメモリ(睡眠・食事・予定種別バッファ・確認履歴)を保持し、次回は仮置き+まとめ承認にする。
- spec 対応: §4、§6(仮置き条件)
- タスク分解例:
  1. プロファイル domain 型と confidence / lastConfirmedAt / source(user_confirmed / inferred)の設計(型とテストのみ)
  2. intake 開始時のプロファイル読み込み → constraints への仮置き展開(assumption 扱い)
  3. 「前回と同じ前提にしています」のまとめ承認 decision
  4. 保存層(localStorage か repository か)— **要ユーザー判断を先に取る**
- 前提: constraints の command 化・identity 管理が安定していること(済)。保存先の判断が必要なため、設計タスクを先行させる。

### Phase R6: 進捗記録と見積もり補正

- 目的: spec §7–8 の実績時間+進捗位置の記録と、見積もり補正(estimateBias)/ 予定実行率(scheduleAdherence)の分離管理。
- spec 対応: §7、§8
- タスク分解例:
  1. 進捗記録の domain 型(予定/実績の時間と進捗開始・終了位置、体感の重さ)とテスト(UI なし)
  2. 記録 → 残り作業再計算の純関数(remaining work items との接続)
  3. estimateBias / scheduleAdherence の算出と保持(混ぜない)
  4. 記録 UI(予定カード内)— UI が絡むため roadmap 更新と要ユーザー確認の後
- 前提: R3(進捗単位一般化)が先。year 固定のまま記録型を作ると作り直しになる。

### Phase R7: 再計画

- 目的: spec §11 の再計画トリガー判定(決定的コード)と、削除理由の選択式ヒアリング、再配置。
- spec 対応: §11、§3(7日目予備日への回し込み)
- タスク分解例:
  1. 再計画トリガー判定の純関数(予定変更・実績乖離・削除の検出。副作用なし)
  2. 削除理由ヒアリングの条件判定(30分以上・締切影響・繰り返しのみ聞く)
  3. 再配置の dry-run(userEdited 保護は既存 draft block への属性追加から)
- 前提: R6 のデータ(実績・進捗)がないとトリガー判定が動かないため R6 の後。

### Phase R8: 配置品質と scheduler 統合【最後】

- 目的: spec §3(6等分・上限1.5倍・7日目予備日)、§9(集中時間帯・重い課題の枠・休憩ルール)を新 path に導入し、長期的に二系統 scheduler の availability モデルを揃える。
- spec 対応: §3、§9、§4(学習可能時間推定)
- タスク分解例:
  1. 6等分ベース配分の純関数(dry-run generator の前段。既存 `dailyDistribution.ts` との整合を先に調査)
  2. 7日目予備日ルール(候補生成時のペナルティ)
  3. 休憩ルールの明示化(現 breakMinutes 固定からの拡張)
  4. busy interval 型の二系統整合(統合ではなく型合わせから)
- 注意: scheduler 本体の大改造は roadmap 更新と設計文書化を先行させる。R8 のタスクは小さく切れるものだけ先行してよい(例: 7日目ペナルティ)。

## 4. 優先順位の理由

順序の骨格(2026-07-07 更新): **R1(クローズ)→ R2-AI(interpreter+renderer 基盤・実接続=R2-A/B/C/D 完了)→ R2-S(実使用スモーク correctness=完了)→ R8(capacity=配置品質)/ R3(進捗単位)/ R2 中タスク(明示 duration・target)→ R5(プロファイル)→ R6(進捗記録)→ R7(再計画)**。

現在地は R2-AI / R2-S の消化直後。AI interpreter・AI renderer の両方が実接続され、correctness の土台(yearRange・既存予定除外・生活制約・sleep/study start・予備日・個別削除・atomic・質問計画)はすべて完了・closed。R4(質問計画)は R2-S の D/E で先取り済み。次の主戦場は、実使用で顕在化した **capacity 超過(R8: 6等分・1日上限)** と、入力理解拡大(R3 進捗単位一般化 / R2 中タスクの明示 duration・target)。renderer / interpreter の実 AI 品質評価(実ブラウザスモーク)は各1回、別途行う。

R2 初期を最優先とする理由: 実ユーザーの利用で確認済みの体験問題であり、修正の入り口(parser・dialogue 文言・分類判定)がすべて特定済みで、R1 で整えた command boundary の上に小さく載せられるため。R2/R3 の本格的な入力理解拡大は、この初期対応と中タスクの設計メモを踏まえてから進める。

1. **command boundary と reducer 薄化が最初。** すべての入力が正規化された command になっていないと、後段の質問計画・プロファイル・再計画が「経路ごとの特別処理」を持ち始め、spec §12 の責務分離が崩れる。fallback が残ったままだと、どの改善も fallback 経路で挙動が割れるリスクを抱える。
2. **自然言語理解の拡大(R2)と単位一般化(R3)がその次。** 質問計画(R4)は「何が missing か」を正しく検出できて初めて意味を持つ。検出できない情報は質問対象にもならないため、入力理解が先。R2 の量・単位表現と R3 の unitKind 型は相互依存があるので、R3-1(型定義)を早めに置き、R2 は表現ごとに独立タスクで進める。
3. **質問計画(R4)は missing / ambiguity の発生源が安定してから。** 質問の優先度は missing の種類に依存する。R1 前に作ると、fallback 由来の missing と command 由来の missing が混ざった状態を policy 化してしまう。
4. **生活プロファイル(R5)は constraints 管理の安定が前提+保存設計の判断が必要。** constraints の command 化と identity / dedupe は済んでいるため技術的には着手可能だが、保存先(localStorage / repository)と保持範囲は spec 外のユーザー判断であり、判断を取ってから本実装に入る。
5. **進捗記録(R6)→ 再計画(R7)は一方向依存。** 再計画トリガー(実績乖離・進捗遅れ)は記録データがないと判定できない。また R6 は R3 の後(記録の単位が year 固定だと一般化時に作り直し)。
6. **配置品質と scheduler 整合(R8)は最後。** 配置スコア・6等分・休憩などの品質改善は、入力理解と進捗データが揃うほど効果が出る。先にやると、後段の型変更のたびに scheduler を触り直すことになる。二系統 scheduler の統合は最も高リスクで、独立した設計文書なしに着手しない。

## 5. タスクmdへの落とし込み方

- **切り出し単位**: 各 Phase の「タスク分解例」の1項目 ≒ タスクmd 1本。Codex の1回の中規模作業(対象ファイル数個、テスト1〜3ファイル)で潰せることを基準にする。
- **1タスク1変更**: 複数の大きな変更(例: parser 拡張と reducer 薄化、型追加と挙動変更)を混ぜない。挙動変更なしのリファクタと挙動追加は必ず別タスクにする。
- **テンプレート**: `docs/ai/task-brief-template.md` に従い、「現在の処理経路」は必ず切り出し時点の実コードを再調査して書く(この roadmap の記述も古くなり得る)。
- **触らない範囲**: 本 roadmap §7「今やらないこと」を各タスクmdの「触らない範囲」の初期値として使う。
- **完了処理**: 実装 → ユーザー承認の後、タスクmdを `docs/ai/tasks/closed/` へ移動する。closed 内のタスクmdは記録なので書き換えない。承認前のタスクmdは `docs/ai/tasks/` 直下に残す。
- **Phase をまたぐ発見**: タスク実装中に見つかった別問題は、そのタスクで直さず、roadmap の該当 Phase に追記するか新規タスク候補として報告する。

直近の到達点(2026-07-08・更新): R1 に加え、R2-AI(interpreter+renderer の基盤・実接続・candidate 契約)と R2-S の correctness 群がすべてクローズ済み。**現在オープンなタスクは3本**(Phase R2-Capability。`constraint-source-capability` / `renderer-deterministic-context` / `clarification-semantic-intent`。依存順は R2-Capability 節を参照)。加えて `completion-target-model` は実装済み stale(verify 後 closed)。設計根拠は `docs/architecture/weekly-planning-nl-capability-model.md`。

## 6. 最初に切るべきタスク候補

> 2026-07-08 更新: Phase **R2-Capability** の3 task を発行済み(open 3本)。**次に着手すべき1本は `constraint-source-capability`(基盤・vertical slice)**。理由: 実使用で体感最悪の「授業・バイトを伝えたのに broad 再質問」を、既存 capability の intake 可視化で直せ、以後の同種問題(capability はあるが intake が知らない)の手本になる。renderer の planning period 部分(実例1)は基盤に依存せず先行回収してよい。以下は capacity 等の中期候補(R2-Capability の後)。
>
> 2026-07-07 時点の候補(実使用スモークの残課題と依存で判断):
>
> **次に切る候補**:
> 1. **capacity 超過の配分(R8 の先取り)** — 過去問全量で 100 時間超が計画ウィンドウに収まらず `ask_relax_constraints` に落ちる既知挙動。spec §3 の 6等分・1日上限(基準作業量 ×1.5)を新 intake path の generator に導入。予備日(`7b3e288`)と接続する配置品質の中核。
> 2. **renderer / interpreter の実 AI 評価(実ブラウザスモーク各1回)** — R2-C-eval と同型。renderer は実接続直後で実挙動未検証。
> 3. **明示 duration / daily・weekday・weekend target の受理**(R2 初期の中タスク)— 設計メモ先行。
> 4. **既知カレンダー予定の intake 注入・差分提示**(staged 候補 b)/ 分割許可の確認対話(staged 候補 c)。
> 5. 監査由来の小改善: renderer の無質問ターン AI コール抑止ガード(コスト削減・正しさ影響なし)。
>
> **次に着手すべき1本: capacity 配分(R8 先取り)。** 理由: correctness の土台と AI 入出力が揃った今、実使用で「生成はできるが全量が収まらず relax を促される」ことが体験上の最大の残欠落であり、予備日実装と直接つながる配置品質の中核。ただし着手前に設計メモ(6等分・上限・7日目予備日との整合)を先行させる。軽い先行として候補5(renderer コスト抑止ガード)を回収してもよい。

1. **短答 slot filling(R2初期-1)** — 「3時間です」を直前質問の回答として受理し、再質問ループを止める。体験への影響が大きく範囲が小さいため最初の1本。
2. **情報不足と条件矛盾の分類分離(R2初期-2)** — dialogueManager の decision 判定と文言の対応修正。
3. **年度範囲「から〜まで」対応(R2初期-3)** — parseYearRange のパターン追加と完了年度側 parser との共通化検討。
4. **受理済み条件の応答反映と文言トーン改善(R2初期-4)** — 表示・文言のみ。
5. **明示 duration と過去問文脈の共存の設計メモ(R2初期-5)** — 実装ではなく設計メモ。daily/weekday/weekend target(R2初期-6)の設計もあわせて検討してよい。

推奨順は 1 → 2 → 3 → 4 → 5(2〜4 は独立なので入れ替え可)。切る時点で実コードを再調査すること。

## 7. 今やらないこと(現時点で触ると危険な範囲)

個別のタスクmdで明示されない限り、以下に着手しない。

- **scheduler 本体の大改造・二系統統合**: 旧 availability-aware path と新 dry-run path の slot search 統合は、整合設計の文書化が先。第三の availability 概念を作ることも禁止。
- **UI / CSS の大改修**: `WeekView` / `DayView` / `DayTimeline` / `NaturalLanguageAssistant` の構造変更。R4 の選択肢質問や R6 の記録 UI も、domain 側を先に固めてから最小の UI タスクとして別途切る。
- **保存・承認導線の変更**: `shouldSavePlan: false` の維持を崩す変更、自動保存、承認フローの変更。
- **`looksLikeWeeklyPlanningRequest` の分岐変更**: 通常予定/週間計画ルートの regression set(R1-2 とその通常予定側)が揃うまで挙動を変えない。
- **`PlanningIntakeState` の全面置換・`yearRange` 削除 migration**: R3 は互換層で進める。
- **Q-learning 的な学習補正・ML による state 直接更新**: 見積もり補正(R6)も決定的な係数計算に留める。ML/LLM の挿入点は command 生成(interpreter boundary)と評価・ランキングに限定し、それも command boundary 安定後。
- **LLM 接続の実装**: `WeeklyPlanningIntakeInterpreter` boundary は確保済みだが、接続はプロキシ・コスト・プロンプト設計の判断が必要。ユーザーと方針を決めてから roadmap を更新して着手する。
- **LangGraph 等のフレームワーク導入**: 旧 codex-implementation-guide v2 に記載があるが、現行の決定的パイプラインで代替できている。導入判断はユーザー確認事項。

## 8. リスク

- **設計リスク(exam prep 特化の一般化)**: R3 で型を広げる際、`WeeklyPlanningDraftRequest` の narrow 型(NonNullable yearRange 等)に依存したコードが連鎖的に壊れやすい。互換 helper と unitKind ごとの段階導入で緩和する。一度に ready 条件を緩めない。
- **テスト不足リスク**: fallback 経路と scheduler の暗黙推定はテストが薄く、リファクタで静かに挙動が変わり得る。R1-2 / R1-4 のテストタスクを、対応するリファクタより先に完了させる。
- **二重化リスク(旧 path と新 path)**: unavailable / availability / busy interval の概念が旧 conditions(`unavailableRanges`)と新 constraints(`LifeConstraint`)に分かれている。新機能は必ずどちらかの既存概念に乗せ、第三の概念を作らない(判断に迷う場合は roadmap を更新して決める)。
- **自然言語処理の誤検出リスク**: 正規表現ベースの parser は表現追加のたびに過剰マッチ(例: 否定・条件・予定表現の完了扱い)が起きやすい。R2 の各タスクに「マッチしてはいけない入力」のテストを必須とし、曖昧な場合は hard 確定せず ambiguity に倒す既存パターンを踏襲する。
- **タスクmd肥大化リスク**: Phase をそのままタスクmdにすると Codex の1回作業を超える。タスクmdは Phase の分解例1項目単位で切り、テンプレートの「触らない範囲」「受け入れ条件」で輪郭を固定する。切り出し時に対象ファイルが5個を大きく超えるなら、さらに分割する。
- **文書の陳腐化リスク**: この roadmap 自体も実装が進むと古くなる。タスクmdを切るときは必ず実コードを再調査し、食い違いがあれば実コードを優先して roadmap を更新する。
