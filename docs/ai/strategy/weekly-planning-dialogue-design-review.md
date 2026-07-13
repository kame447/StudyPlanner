Status: **historical evidence / recommendations superseded by v4**
Current DoR: ../../architecture/weekly-planning-dialogue-architecture-v4.md

W1〜W7 observations and production path traces below are retained as historical evidence. Old recommendations and task order are not the current queue.

# 週間計画機能 対話設計レビュー(2026-07-10)

> **ステータス: evidence record。** W1〜W7、実会話トレース、既存安全境界の調査結果は有効である。ただし §3.3 と §5 の「質問対象は deterministic、AI は文面のみ」という推奨は親設計 v4 により superseded である。現在の到達像は [親設計 v4](../../architecture/weekly-planning-dialogue-architecture-v4.md) を参照する。

> **2026-07-11 追記**: 本文書の §3.3「望ましい分担」と §5 の推奨順序は、その後の思想再構成(v2: **draft-first / progressive refinement**、v3: **意味解釈の AI 単一責務化** — deterministic parser との並列 merge を廃止し、毎 turn を会話履歴つきで AI が解釈する)により更新された。**現在のDoRは `docs/architecture/weekly-planning-dialogue-architecture-v4.md`(v4)**であり、本文書は W1〜W7 の調査記録・実測根拠として参照する。

実使用で報告された「対話が硬く不自然」な問題群(期間表現が generic error に落ちる / 自然な目標・constraint source 表現が受理されない / 訂正しても同じ質問が繰り返される)について、`src/features/weeklyPlanning/` を production path に沿って調査した結果。個別 parser の欠陥列挙ではなく、**deterministic 処理と AI(GPT 系モデル)の責任分担が対話として成立しているか**を評価する。

- 位置づけ: `docs/architecture/weekly-planning-nl-capability-model.md`(診断原則 A〜F・GoalIntent 設計)の対話面への拡張。同文書の枠組みを引き継ぎ、対話固有の欠落(grounding・対話 act 記憶・catch-all)を追加で特定した。
- 検証方法: 実コード読解 + 報告発話の production path トレース(rules モード実行・AI モードは stub interpreter とコード追跡)。
- 関連: `weekly-planning-review-20260710-index.md`(同日の構造レビュー成果物索引)、`weekly-planning-deferred-backlog.md`
- 最終更新: 2026-07-10

## 1. 報告事例のトレース結果

前提: 週間計画モードの入力はすべて `runWeeklyPlanningIntakePipeline(WithInterpreter)` → `createWeeklyPlanningDialogueDecision` → `renderWeeklyPlanningDialogueMessage` を通る。

### 事例1: 「予定作りたい」「明日と明後日の予定立てたい」「来週の予定を立てたい」→ generic error

3発話とも同じ経路で catch-all に落ちる:

1. deterministic parser: range 系は `hasOneWeekDuration`(「一週間/1週間/7日間」)か pending 解決しか通さず、pending 化 gate は `/来週.*計画/`(**「予定」は弾く**)。「明日」「明後日」を解決する parser は存在しない。exam scope・constraint 系も無反応。
2. legacy fallback 入口 `looksLikeWeeklyPlanningRequest` は「週キーワード + `N時間` 表現2件以上」を要求 → 3発話とも false。
3. 結果: intent `unknown`・missing `[]`・status `idle`。
4. `createWeeklyPlanningDialogueDecision` は missing 空・ambiguity 無し・draft 不能のとき**最終 else が `cannot_create_draft`** →「条件の整合性が取れず、仮予定候補を作れませんでした。追加で条件を確認してください。」— 情報がゼロなのに「整合性が取れず」と返す。
5. AI モードでも結末は同じ: escalation は発火するが、(a) **AI は現在日時を知らない**(§2 W3)ので「明日」「来週」を日付化できず、(b) 「計画を始めたい」という開始 intent を表す command が存在しない(§2 W4)ため、安全側指示(「不十分なら空 candidates」)に従い空を返すしかない。

### 事例2: 「数学のテスト勉強したい。予定はカレンダーと時間割の予定ぐらいかな」→ 同じ情報を再質問

2つの独立した欠落が重なる:

- **目標側**: 「数学のテスト勉強」を受理する手段が無い。`hasExamScopeSignal` は 院試/分野/年度範囲/第N部 のみ。`state.tasks` へ書けるのは legacy fallback(週語+時間2件 gate)だけで、**「学習目標を設定する」command が deterministic にも AI schema にも存在しない**。ユーザーが何度言い換えても tasks_or_goals は充足しない。
- **constraint source 側**: AI が `use_constraint_source` を出せても、「カレンダー」は ambiguous container 扱いで(複数 source 有効時)clarification に倒れる。現行 pipeline は clarificationRequest があると**同ターンの accepted commands を全破棄**する(構造レビュー問題6 = T4・historical/superseded)ため、「時間割」の理解も一緒に消える。
- 結果: どちらの情報も state に残らず、次ターンで同じ質問が出る。

### 事例3: 「テスト勉強はゴールでしょ？」(修復発話)→ 元の質問を反復

ユーザーは「前の発話がすでに質問への回答だった」と対話自体を訂正しているが、これを扱う構造が三重に欠けている:

1. **直前に何を聞いたかが interpreter に渡らない**: `InterpreterStateSummary` は knownFields / confirmedSlots / planningRangeSummary / pendingPlanningRange / availableConstraintSources のみ。直前の questionPlan・assistant 発話は state にも summary にも無い。モデルは「ゴールでしょ？」を何に結び付ければよいか知り得ない。
2. **修復を反映する語彙が無い**: 「テスト勉強」を tasks_or_goals へ書く command が無い(事例2と同根)。
3. **反復抑制が無い**: decision は毎ターン missing から機械的に再計算され、「同じ slot を何回聞いたか」「ユーザーが回答を試みて失敗した形跡」を考慮しない。同一文言の質問が無限に繰り返される。

## 2. 根本的な弱点(構造)

| # | 弱点 | 実体(実コード) | capability model 分類 |
|---|---|---|---|
| W1 | **会話の入口が「期間表現 parse 成功」に依存** | missing の seed は `set_planning_range` / `set_pending_planning_range` / legacy fallback しか行わない。開始 intent(「計画を作りたい」)を表す表現手段が無く、parse に失敗すると質問すら出せない | B(意味カテゴリ不足) |
| W2 | **catch-all decision** | `createWeeklyPlanningDialogueDecision` の最終 else が「情報ゼロ(idle)」「構造的に draft 不能(非 exam)」「真の条件矛盾」をすべて `cannot_create_draft` の同一文言で返す | E(遷移不足)+ roadmap R2初期-2 残余 |
| W3 | **AI interpreter に grounding が無い** | `interpretUserTurn({ userText, stateSummary })` — **context(currentDateTime / selectedDate)は受け取りながら分割代入で破棄され、プロンプトに渡らない**(`createUserPrompt` は userText + stateSummary のみ)。直前質問も渡らない。「past turns を仮定するな」という正しい原則の代償として必要な「現在の対話状態の構造化供給」が欠落 | 新分類 **G: dialogue grounding 不足** |
| W4 | **AI の行動空間が狭すぎる** | AI は deterministic parser と同一の command 集合に閉じており(capability model §1.1)、そこに 開始 intent・非 exam 学習目標・修復 の3つの頻出意味カテゴリが無い。**モデルは発話を理解できても、理解した意味を返す型が無い** | B/C |
| W5 | **対話 act の記憶が無い** | 「直前に何を聞いたか」は state に構造化されない(`state.questions` は文字列配列で本番未使用)。短答 slot filling は `parseBareDurationAsUnitRateCommand` + `missing.includes('unit_duration_estimate')` の unit_rate 専用ハードコード1本のみで、一般機構が無い | G |
| W6 | **反復抑制・質問政策が無い** | 質問回数・言い換え・選択肢化・「分からない」の仮置き(spec §5–6)が未実装(roadmap R4)。W1〜W5 と組み合わさり「同じ質問の機械的反復」として現れる | E + R4 既知 |
| W7 | **parser の増築様式が発話パターン単位** | 例: `parseLifeConstraint` 内の「今日は2時…寝→26:00」専用 regex、`parseFixedEvent` のキーワード列挙、`looksLikeWeeklyPlanningRequest` の「週語+時間2件」。表現ゆれは無限であり、この様式では W1〜W4 を regex 追加で追い続けることになる | A(アンチパターンとして既知・capability model §8.4) |

## 3. 責任分担の評価

### 3.1 現状すでに正しい部分(維持する)

- **確定値の防衛線**: validator の型/enum/値域検証、confirmedSlots(T2 で実体導出化済み)、pending range 保護・explicit range 保護(T1/T3)、`shouldSavePlan: false`。AI 出力を hard-apply する前の deterministic 検証 contract は**既に十分に堅く、AI の裁量を広げても壊れない土台になっている**。
- **scheduler の純粋性**: busy interval・配置・容量は自然言語を見ない。
- **「何を聞くか」= deterministic questionPlan、「どう言うか」= AI renderer** の分離(R2-D)。
- **escalation 方式**(deterministic 先行・失敗時のみ AI)もコストと安定性の観点で妥当。

### 3.2 GPT 系モデルの能力を構造的に殺している部分

問題は「AI に任せる範囲が広すぎる」ことではなく、**escalation で AI に渡した後の入力と出力の両方が細すぎる**ことにある:

- 入力(grounding): 現在日時なし・直前質問なし → 日付相対表現・短答・訂正・言い換えという**モデルが最も得意な文脈解釈をする材料が無い**。
- 出力(語彙): 開始 intent・学習目標・修復が表現できない → 理解しても返せない。
- その結果、「モデルが自然に理解できる発話を、狭い parser と狭い schema の共通部分まで縮めてから捨てている」のが現状の対話。

### 3.3 望ましい分担(到達像)

```text
deterministic に固定(最終決定権):
  日付・時刻・年度の値検証 / range・pending の遷移 guard / missing・confirmedSlots /
  busy interval・配置 / 質問の対象選択(questionPlan)/ 保存・承認導線

モデルに任せる(解釈権):
  表現ゆれ → 意味カテゴリへの写像(開始・目標・制約・進捗・修復・聞き返し)
  日付相対表現の解決(grounding された現在日時から。値は validator が検証)
  直前質問への短答・訂正・言い換えの anchor 付き解釈
  質問文の自然文化(既存 R2-D)

contract(両者の接続):
  AI への入力 = userText + 構造化された対話状態
    (currentDateTime / 直前 questionPlan / confirmedSlots / pending / capability 可用性)
  AI からの出力 = 有限の意味カテゴリ(command)+ confidence
  適用 = validator(値域・slot・pending 保護)→ reducer(遷移 guard)
```

到達像の対話例(事例2の理想形):

> ユーザー「数学のテスト勉強したい。予定はカレンダーと時間割の予定ぐらいかな」
> アプリ「数学のテスト勉強を目標として受け取りました。授業などの予定は登録済みの時間割と予定を使います。いつからいつまでの計画にしますか？」

これは (a) 学習目標の意味カテゴリ、(b) constraint source の受理(T2/T3 で実装済み・T4 で破棄問題解消)、(c) 受理事実の acknowledgement(renderer は既に対応済み)、(d) 期間質問(W1 の entry)で構成でき、**全文 LLM 生成は不要**である。

## 4. 既存タスク・backlog・roadmap との対応(重複整理)

本調査の発見のうち、既存管理と重複するものは新規タスク化しない:

| 発見 | 既存の管理先 | 本調査での扱い |
|---|---|---|
| 事例2の constraint 側破棄(clarification が accepted を捨てる) | **T4**(`20260710-weekly-planning-clarification-accepted-orthogonality.md`・historical/superseded) | 重複作成しない。優先度を上げる根拠が増えた(実使用事例2) |
| 質問文言・slot 定義の分散 | **T5**(`20260710-weekly-planning-question-slot-registry.md`・historical/superseded) | 重複作成しない。新 slot 追加(T8)は T5 の後を推奨 |
| 複合ターン regression | **T6**(`20260710-weekly-planning-multi-slot-turn-regression.md`・historical/superseded) | 対話シナリオ(entry・grounding)は各新タスクの受け入れテストで担保し、T6 はhistorical/supersededでcurrent queueではない |
| 非 exam 学習目標が受理できない(事例2・3の目標側) | **D2 / roadmap R3**(+ D1 fallback 縮小が前提) | 追加調査(同日)の結果、既存 `StudyTaskScope` で表現可能な会話レベルの最小 slice を特定し、**Stage 3 タスクとして発行**(scheduling 一般化は R3 のまま)。詳細は親設計 §10 |
| 「情報不足を『整合性が取れず』と言わない」 | roadmap **R2初期-2**(部分吸収済みとされていた) | idle catch-all として残存していることを確認。新タスク **T8** のスコープに含める(R2初期-2 の残余の消化として) |
| 質問の反復抑制・選択肢・「分からない」仮置き | roadmap **R4** | 新規作成しない。W5 の最小部分(直前質問の構造化供給)のみ **T7** に含め、質問履歴・反復抑制の本体は R4 に残す |
| parser 増築様式(W7) | capability model **§8.4** | 文書済み原則。新規 md 不要 |

> **2026-07-10 追記**: 本節の発見は同日の追加調査で親設計 `docs/architecture/weekly-planning-dialogue-architecture.md` に統合し、段階実装として発行した。以下の T7/T8 構想は Stage 1/Stage 2 に対応する(名称・スコープは親設計側が正)。

新規にタスク化したもの(親設計 §9 の Stage 1〜3):

- **Stage 1: interpreter への対話 grounding 供給**(W3 + W5 の最小部分)→ `docs/ai/tasks/20260710-weekly-planning-dialogue-stage1-interpreter-grounding.md`
- **Stage 2: 開始 intent の受理と decision taxonomy 分離**(W1 + W2)→ `docs/ai/tasks/20260710-weekly-planning-dialogue-stage2-entry-intent-decision-taxonomy.md`
- **Stage 3: 学習目標受理 + legacy fallback 保護**(W4 の目標語彙・D1/D2 の会話レベル slice)→ `docs/ai/tasks/20260710-weekly-planning-dialogue-stage3-goal-acceptance.md`

## 5. 推奨順序

```text
T4(open・小・事例2の破棄問題)
→ Stage 1(grounding。AI 系ファイルのみ)
→ T5(registry。Stage 2 の新 slot 追加を1箇所化するため先行)
→ Stage 2(entry intent + taxonomy 分離。事例1の3発話を解消)
→ Stage 3(goal 受理。事例2・3の目標側)
→ Stage 4〜7(親設計 §9。訂正 envelope / ActPlan renderer / 常時解釈 / contract suite)
→ T6(複合ターン regression suite。Stage 7 と統合実行)
```

- 事例1(generic error)は Stage 2 で解消、Stage 1 完了後は「明日と明後日」も AI 経由で日付化できる。
- 事例2は T4(破棄解消)+ T2/T3(実装済み)+ Stage 3(目標受理)で段階的に解消。
- 事例3(修復)は Stage 1(anchor 供給)+ Stage 3(目標語彙)で基本形が動き、訂正の形式化は Stage 4。**修復専用の機構は作らない**(直前質問の grounding があれば、修復は「anchor 付きの通常回答」としてモデルが解釈できるため)。

## 6. 診断原則への追記提案

capability model §6 の A〜F に、本調査で確認した対話固有の分類を1つ追加することを提案する(次回 capability model 更新時に反映):

> **G. dialogue grounding 不足**: 意味カテゴリも capability も揃っているが、「いま対話がどこにいるか」(現在日時・直前の質問・確認待ちの事項)が interpreter/renderer に構造化供給されておらず、モデルが文脈解釈・修復応答をできない。直し方: 対話状態の deterministic な要約を AI 入力 contract に追加する(履歴の生ログを渡すのではなく)。
\n\nHistorical handling: current action/state/response/fallback decisions are defined by v4 and the current queue, not by this review.\n