# weeklyPlanning 改善ロードマップ

この文書は、`docs/weekly-planning/weekly-planning-spec.md`(以下 spec)の理想仕様と現実装の差分をもとに、weeklyPlanning 機能の改善順序・優先度・リスク・今やらないことを定める上位計画である。

**この文書は Codex に直接実装させるタスクmdではない。** 方向性と優先順位を決める文書であり、ここから Claude/Fable が `docs/ai/tasks/*.md`(Codex が1回で潰せる実装単位)を切り出す。

- 作成日: 2026-07-02
- 実コード基準: `note_progress_boundary` command 導入後(progressHint の command 化は実装・承認・コミット済み)
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

### Phase R1: command boundary の完成と reducer 薄化【基盤】

- 目的: reducer から自然言語解釈を完全に排除し、すべての入力経路を parser → command → adapter → reducer に統一する。
- spec 対応: §12(責務分離の基盤)
- タスク分解例:
  1. uncertainty 正規表現の command 化(`note_uncertainty` 等。挙動変更なし)
  2. legacy fallback 経路の regression テスト整備(テストのみ。fallback を通る入力・通らない入力の spec 化)
  3. legacy fallback の隔離(fallback 呼び出しを明示的な境界関数へ切り出す。2 の後)
  4. `constraintToBusyInterval` の暗黙推定ルールの明文化テスト(テストのみ)
- 完了条件の目安: reducer が日本語を一切見ない。fallback が単一の境界関数越しになる。

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

順序の骨格: **R1(境界完成)→ R2/R3(入力理解の拡大)→ R4(質問計画)→ R5(プロファイル)→ R6(進捗記録)→ R7(再計画)→ R8(配置品質とscheduler整合)**。

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

直近完了タスク: progressHint の command 化(`docs/ai/tasks/closed/20260702-weekly-planning-progress-hint-command.md`、実装・承認・コミット済み)。運用循環の最初の1周が完了している。現在オープンなタスクは `docs/ai/tasks/` 直下を参照する(この roadmap には個別のオープンタスクを列挙しない)。

## 6. 最初に切るべきタスク候補

roadmap を踏まえた次のタスクmd候補(今回はタスクmdを新規作成しない。切る時点で実コードを再調査すること)。

1. **uncertainty 正規表現の command 化(R1-1)** — reducer 直書きの `知らない分野.*時間かかる` を parser + command(例: `note_uncertainty`)へ。挙動変更なし・小粒で、progressHint command 化と同じパターンの3点セット(parse / adapter / apply)。reducer 薄化がこれで uncertainty 分は完了する。
2. **legacy fallback の regression テスト整備(R1-2、テストのみ)** — `applyWeeklyPlanningUserTurn` 経由で fallback(`assessWeeklyPlanningRequest` / `mergeWeeklyPlanningRevision`)を通る入力・通らない入力を spec 化する。fallback 隔離(R1-3)と将来のルート分岐変更の前提。
3. **`constraintToBusyInterval` 暗黙推定の明文化テスト(R1-4、テストのみ)** — meal の end−60分既定、durationMinutes fallback などをテストで固定し、R8 の配置改善の安全網にする。
4. **締切表現の parser + command 追加(R2-1)** — spec §5 の「締切はあるか」への最初の対応。missing / dialogue との連動を含むため、上記より一回り大きい。
5. **`TaskProgressScope` / `unitKind` の型定義と互換 helper(R3-1)** — 挙動変更なしの型導入。R2 の量・単位表現タスクの受け皿になる。

推奨順は 1 → 2 → (3 は随時) → 4 または 5。1 と 2 は独立なので、どちらを先にしてもよい。

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
