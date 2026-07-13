Status: **historical / superseded by v4**
Current DoR: docs/architecture/weekly-planning-dialogue-architecture-v4.md

This v3 document is preserved as historical evidence. Its old implementation order, current queue references, and fixed-question recommendations are not current instructions.

# weeklyPlanning 対話アーキテクチャ(親設計 v3: AI 単一意味解釈 + draft-first)

> **ステータス: superseded（履歴・実装移行記録）。** 2026-07-13 からの唯一の設計の正は [親設計 v4](weekly-planning-dialogue-architecture-v4.md) である。本書は v3 で確立した AI 単一意味解釈、command validation、reducer、rules fallback の根拠と完了済み実装の記録として残す。通常経路を deterministic DialogueDecision と固定 questionPlan で主導する記述は v4 により置き換えられた。

v2(2026-07-10)で最上位思想を draft-first / progressive refinement に改訂した。**v3(2026-07-11)は意味解釈の責務を確定した**: 自然言語の意味解釈は AI interpreter の単一責務とし、deterministic parser と AI を並列の意味解釈器として動かして merge する構造を廃止した。

- 目標構造:
  ```text
  会話履歴 + 現在 state + active question + assumptions + preview context
  → AI semantic interpretation(単一の意味解釈層)
  → typed command / semantic act(state を直接変更しない)
  → deterministic normalization / validation
  → reducer(guard 込み)
  → scheduler / preview / approval / save(deterministic)
  ```
- v2 の draft-first 原則(preview を対話の材料にする・仮定合成・preview-first decision)は不変。v3 はその**解釈層の一本化**である。
- 関連: `weekly-planning-nl-capability-model.md` / `docs/ai/strategy/weekly-planning-dialogue-design-review.md` / spec §12(LLM の担当 = 自然文からの抽出)
- 本文書は Codex に直接渡さない。実装単位は §7。
- 最終更新: 2026-07-11(v3)

## 1. v3 の根拠(実会話・実コードで確認)

次の実会話で「ハードウェア分野を主にやる」が state に反映されず、後から優先順を再質問した:

> ユーザー: 「今日明日の計画を立てたい / やることは院試の過去問で、ハードウェア分野を主にやる / 年度は2024~2019」
> アプリ: 「対象年度は2024〜2019で受け取りました。1年分または1単位あたりの目安時間を教えてください。」
> ユーザー: 「だいたい3時間くらい」
> アプリ: 「了解です。優先したい分野や、進める順番はありますか？」

処理経路上の原因(いずれも構造問題であり、この一例の regex 追加では直さない):

1. **escalation 抑制**: `shouldEscalateToInterpreter` は「deterministic が command を1つでも生成し、missingBefore が空 or missing が減った turn」で AI を呼ばない。turn 1 は `set_exam_scope`(院試 + 2024~2019)が deterministic に成立したため **AI は発話全体を一度も見ていない**。turn 2 も `parseBareDurationAsUnitRateCommand` の短絡で AI 抑制。
2. **deterministic parser の意味カバレッジ**: `parsePriorityPolicy` は「数学/ソフトウェア + 特定接続詞」専用の regex 群で、「ハードウェア分野を主にやる」に一致する意味判定を持たない。発話パターン単位の増築様式(capability model §8.4 のアンチパターン)の帰結。
3. **会話履歴の欠如**: interpreter への入力は userText + context + stateSummary(lastQuestions 含む)のみで、時系列の会話履歴は渡らない。system prompt は past turns の参照を禁止している。このため後続 turn で AI が呼ばれても「turn 1 でハードウェア優先と言った」事実を回収(reconciliation)できない。

つまり現状は「deterministic が先に走り、失敗時だけ AI が同じ command 空間で再挑戦する」**並列解釈 + 抑制付き merge** であり、複合発話・言い換え・省略・誤字・訂正・過去発話の再提示という自然会話の主要ケースで系統的に情報を落とす。

## 2. 中核原則(v3 で確定)

1. **意味解釈は AI interpreter の単一責務。** provider 利用可能時は**毎 user turn** を AI が解釈する。deterministic parser を意味解釈器として併走・merge しない。
2. **AI への入力は「recent conversation history + structured state」の両方**: 直近の会話履歴(user/assistant 数 turn)、現在 state summary、active question(lastQuestions)、確定事実と仮定(assumptions)、preview context(直近候補の要約・diagnostics)、現在日時。履歴は deterministic に選別・整形して渡す(生ログの無制限投入や履歴内指示の実行はしない)。
3. **AI の出力は typed command / semantic act のみ**で、state を直接変更しない。適用は従来どおり validator → reducer(guard)を通る。
4. **deterministic 側の責務**: normalization(日付・時刻・曜日解決・calendarDayCount 等の正規化)、validation(shape / enum / 値域 / slot / pending・explicit guard)、reducer / state 遷移、scheduler / busy interval / 配置、preview / approval / save、dialogue policy(taxonomy・preview-first・質問選択)。**配置と保存の最終決定を AI に渡さない**ことは不変。
5. **rules モード(provider 無し)と AI 呼び出し失敗時**は、既存 deterministic parser 群を **fallback として暫定維持**する(merge ではなく経路切替: その turn 全体を deterministic 経路で処理)。AI が「空 candidates」を返した場合は解釈結果として尊重する(fallback しない)。
6. draft-first(v2 §2)の分類・仮定・preview-first は不変。

## 3. 既存 deterministic parser 群の分類

| 分類 | 対象(代表) | 扱い |
|---|---|---|
| **semantic parser(廃止・縮小)** | `parseSetExamScopeCommand` / `parsePriorityPolicy` / `parseMarkCompletedUnits・CompletionTarget・ProgressBoundary` / `parseSetUnitRateCommand`・`parseBareDurationAsUnitRateCommand` / `parseConstraintCommands`・`parseAddUnavailableCommands` / `parseNoteNoFixedEvents`・`parseNoteUncertainty` / `parseSetPlanningRangeCommand`・`parseSetPendingPlanningRangeCommand` の**発話→意図判定部** | provider 時は呼ばない(I1)。rules モード fallback として残置し、新規の意味パターン追加は今後行わない(凍結)。長期的には rules モードの提供範囲自体を縮小検討 |
| **normalization / validation(残す・強化)** | `weeklyPlanningTimeParsing`(時刻)/ 曜日→日付解決(`resolveWeekdayInScope` 相当)/ `calendarDayCount` 正規化(adapter)/ `weeklyPlanningCandidateValidator` 全体 / `weeklyPlanningConstraintIdentity`(dedupe)/ `weeklyPlanningReferenceResolution`(constraint source の可用性 guard) | AI 出力の正規化・防衛線として維持。**pending 中の explicit range は「scope 窓内なら受理」へ調整**(I1。曜日回答の解決を deterministic parse に依存しなくなるため、AI が解決した日付を窓内検証で受ける) |
| **legacy fallback(暫定維持)** | `applyLegacyWeeklyPlanningFallback`(`looksLikeWeeklyPlanningRequest` / transforms 系) | rules モード専用のまま。P4 の `tasksSource` guard で command 由来 state を保護。撤去は backlog D1 / R3 |

## 4. 例に対する到達挙動

- §1 の実会話: turn 1 で AI が発話全体を解釈し、`set_exam_scope`(院試・2024〜2019)と `set_priority_policy`(field_first: ハードウェア先頭)を同時に返す(I1)。仮に turn 1 で漏れても、履歴供給(I2)により後続 turn の「優先順ありますか?」への回答や再提示を過去発話と突き合わせて回収できる。
- v2 §4 の例1〜3(draft-first の判断基準)は不変。

## 5. AI 呼び出しの分離とコスト

- **interpreter と renderer は別呼び出しのまま**(`purpose: weekly_planning_interpreter` / `weekly_planning_renderer`。実装確認済み)。統合しない(解釈の再現性と応答生成の自由度を分ける)。
- 毎 turn 解釈により interpreter 呼び出しは最大 1 call/turn 増える。renderer 側の「質問がない turn は呼ばない」抑止(bb9c446)は維持。これはコストより会話成立を優先する製品判断として v3 で確定する。

## 6. 責任境界(v3 反映版)

| 責務 | 担当 |
|---|---|
| 発話の意味理解(複合発話・誤字・言い換え・省略・訂正・再提示) | **AI interpreter(単一)** |
| 会話履歴・active question・仮定・preview を踏まえた文脈解釈 | AI interpreter(入力は deterministic に整形) |
| 日付・時刻・曜日・日数の正規化、値域・shape・slot・guard 検証 | deterministic(normalization / validator) |
| state 遷移・missing・confirmedSlots・仮定合成 | deterministic(reducer / adapter) |
| 配置・busy interval・容量・診断 | deterministic(scheduler) |
| 応答方針(taxonomy・preview-first・質問選択・最大数) | deterministic(dialogue policy) |
| 応答の自然文生成 | AI renderer(sanitize + deterministic fallback) |
| preview 承認・保存・副作用 | deterministic(UI 導線・`shouldSavePlan: false`) |

## 7. 実装計画(v3 再構成)

| # | 内容 | 状態 | task md |
|---|---|---|---|
| 済 | T1〜T5 / S1(grounding)/ P1(仮定合成)/ P2(preview-first decision) | **実装済み・検証済み**(446 tests green) | closed 参照 |
| **I1** | **AI 単一解釈化**: escalation・bare-duration 短絡の廃止(provider 時毎 turn AI)、provider 時の deterministic semantic parse バイパス、pending 窓内 explicit range の受理調整、AI 失敗時の turn 単位 deterministic fallback | 発行済み・**次に実装** | `20260711-weekly-planning-ai-interpretation-stage1-single-interpreter.md` |
| **I2** | **会話履歴の供給**: UI の会話履歴から直近 N turn を pipeline → interpreter へ。過去発話の再提示・訂正と state の reconciliation 指示。past-turns 禁止文の置換 | 発行済み | `20260711-weekly-planning-ai-interpretation-stage2-conversation-history.md` |
| P3 | 開始 intent + decision taxonomy 分離(v3 改訂: begin 検出は AI 写像中心、deterministic gate は rules fallback) | 発行済み(改訂) | `20260710-weekly-planning-dialogue-stage2-entry-intent-decision-taxonomy.md` |
| P4 | 学習目標受理(`set_study_goal`・AI 経由)+ legacy fallback 保護 | 発行済み(改訂) | `20260710-weekly-planning-dialogue-stage3-goal-acceptance.md` |
| P5 | 非 exam preview bridge(tasks → 暫定量 work items) | 未発行(P4 後) | — |
| P6 | semantic act envelope(answers/corrects の形式化)+ 仮定の対話的置換の構造化 | 未発行(**縮小**: 会話文脈の回収は I1/I2 が担うため、残るのは訂正適用規則と DialogueContext の永続化のみ) | — |
| P7 | AssistantActPlan / renderer 一般化 | 未発行 | — |
| P9 | dialogue contract suite + T6 統合実行 | 未発行(最後) | — |

**推奨順: I1 → I2 → P3 → P4 → P5 → P6 → P7 → P9。**
旧 P8(常時解釈)は **I1 に吸収**。旧 P6 のうち conversation grounding / 過去発話 reconciliation は **I2 へ前倒し吸収**(P6 は訂正の適用規則に縮小)。v2 の P 番号との対応はこの表を正とする。

## 8. dialogue contract(v3 追加分)

v2 §8 の 10 契約に加えて:

11. 複合発話(期間 + 対象 + 優先など)は 1 turn で全意図が解釈・反映され、直後に既出情報を再質問しない。【I1】
12. 過去 turn で述べた事実の再提示・言い換え・訂正が、履歴 + state と突き合わせて回収される(§1 の実会話が regression ケース)。【I2】
13. provider 有効時、deterministic parser の解釈結果が AI の解釈と競合して適用されることがない(単一解釈)。rules モードは全経路 deterministic で成立する。【I1】

## 9. 既存文書・タスクとの関係

- v2 からの変更は §1〜§3・§7 の解釈層のみ。draft-first(仮定合成・preview-first)・taxonomy・goal 語彙・bridge の設計は不変。
- **capability model への影響**: 「AI と deterministic parser が同一 command 空間を共有する classifier」という §1.1 の指摘は、v3 で「同一 command 空間は維持しつつ、解釈器は AI に一本化(deterministic は fallback)」として解消方針が確定。診断原則 A(意味写像不足)の直し先は今後 AI プロンプト/語彙のみとなる。
- roadmap: R2 の「parser の対応表現拡大」系タスクは v3 により**新規追加を凍結**(rules fallback の現状維持のみ)。R4 は P2 で先取り済み。
- backlog: D1(legacy fallback)・D2(非 exam)は従来どおり(P4/P5 が部分消化)。
\n\nHistorical handling: v4 is the only current DoR; use this document for the v3 production trace and safety-boundary rationale only.\n