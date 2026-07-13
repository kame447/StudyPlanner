# 週間計画機能 全体レビュー(2026-07-10)成果物インデックス

> **現在の索引（2026-07-13）**: 設計の正は [親設計 v4](../../architecture/weekly-planning-dialogue-architecture-v4.md)。T1〜T5、S1、P1、P2、I1、I1f、I2、P3 は完了履歴、P4 と T6 は superseded であり、新規実装の順番には使わない。
>
> **現在の実装 queue**: 作業ツリーにある P4 由来差分を所有者が検証・状態確定する gate の後、[D1](../tasks/20260713-weekly-planning-dialogue-action-contract.md) → [D2](../tasks/20260713-weekly-planning-state-grounded-dialogue-orchestrator.md) → [D3](../tasks/20260713-weekly-planning-mentor-conversation-evaluation.md)。一度に open とみなす task は一つだけとする。
>
> 以下は 2026-07-10〜13 のレビュー証跡である。本文の「次に実装」「親設計 v3」「P4 open」などの記述は、この注記より優先しない。
`src/features/weeklyPlanning/` 全体レビュー(実コード読解 + 実行再現検証。既存テスト 405 件 green のまま全問題が本番経路で再現することを確認済み)の成果物一覧。再調査せずにここから辿れるようにする。

- 全体評価: **次の機能追加(R8 capacity / R3 一般化)前に構造修正が必要**。ただし層構造(parser → command → reducer → dialogue → pipeline → scheduler)自体は健全で、修正は有界。
- 主根本原因: 未コミットの temporal scope 実装が「`set_planning_range` は会話の最初のターンでのみ発火する」「missing に無い slot = 回答済み」という2つの暗黙前提を崩した。
- 管理方法: タスクは従来どおり `docs/ai/tasks/`(完了後 `closed/` へ移動)。優先度はタスクmd冒頭の Priority 表記で管理し、優先度別ディレクトリは作らない。
- 最終更新: 2026-07-10

## 1. タスクmd一覧(実装単位)

| # | タスクmd(docs/ai/tasks/) | レビュー問題 | Priority | 状態 | 依存 |
| --- | --- | --- | --- | --- | --- |
| T1 | `closed/20260710-weekly-planning-range-reseed-guard-and-start-date-render.md` | 問題1(missing 再シード)・問題2(explicit range 上書き)・問題4の登録漏れ | **High** | **closed**(2026-07-10 採用・検証済み) | — |
| T2 | `closed/20260710-weekly-planning-confirmed-slots-semantics.md` | 問題3(confirmedSlots の missing 不在 proxy → silent drop) | **High** | **closed**(2026-07-10 採用・検証済み) | — |
| T3 | `closed/20260710-weekly-planning-ai-range-normalization.md` | 問題5(AI 経由 range の calendarDayCount 欠落・pending バイパス) | Medium | **closed**(2026-07-10 採用・検証済み) | — |
| T4 | `closed/20260710-weekly-planning-clarification-accepted-orthogonality.md` | 問題6(聞き返しが同ターンの accepted commands を破棄) | Medium | **closed**(2026-07-11 検証: commit `9933859`・439 tests green) | — |
| T5 | `closed/20260710-weekly-planning-question-slot-registry.md` | 問題4本体(質問 slot 定義の5ファイル分散) | Medium | **closed**(2026-07-11 検証: `weeklyPlanningQuestionSlots.ts`・挙動変更なし・439 tests green) | — |
| T6 | `20260710-weekly-planning-multi-slot-turn-regression.md` | テスト網の穴(複合ターンシナリオ不在) | Medium(テストのみ) | open | 親設計 v2 の P9(contract suite)と統合実行 |

**推奨着手順(2026-07-13 版): ~~T1〜T5・S1・P1・P2・I1・I1f・I2・P3~~(すべて消化済み)→ **P4** → P5〜P9(親設計 v3 §7)→ T6(P9 と統合実行)。次に実装すべきは P4。** 詳細は §1.5。

- T1・T2 が High: どちらも実行再現済みの対話破壊(再質問ループ / silent drop)で、主要ペルソナ経路に直撃するため。
- T5 は T2〜T4 とファイル競合しにくいが、registry へ転記する文言が T1 修正Cで確定してから行う。
- T6 は修正の受け入れテストを恒久 suite 化するもので、必ず最後(bug を期待値に固定しないため)。
- roadmap の「同時オープンは少数(理想1本)」の運用に対し、本レビュー起点で 6 本 open になる。Codex へは推奨順に1本ずつ渡す。

## 1.5 対話設計調査と再構成(2026-07-10 追補 / 2026-07-11 v2・v3 改訂)

構造レビュー後、実使用の対話品質問題について追加調査を実施(調査記録: `docs/ai/strategy/weekly-planning-dialogue-design-review.md`)。2026-07-11 に (a) 最上位思想を **draft-first / progressive refinement** へ(v2)、(b) **意味解釈を AI interpreter の単一責務**へ(v3。deterministic parser との並列 merge 廃止・毎 turn 解釈・会話履歴供給)再構成した。**設計の正は `docs/architecture/weekly-planning-dialogue-architecture.md`(v3)**。実装計画は同 §7。

| # | タスクmd(docs/ai/tasks/) | 内容 | Priority | 状態 | 依存 |
| --- | --- | --- | --- | --- | --- |
| S1 | `closed/20260710-weekly-planning-dialogue-stage1-interpreter-grounding.md` | interpreter への現在日時・直前質問 grounding | High | **closed**(commit `3fd38be`) | — |
| P1 | `closed/20260711-weekly-planning-preview-policy-stage1-assumption-synthesis.md` | 仮定合成層(挙動中立) | High | **closed**(2026-07-11 検証: commit `6803dbd`・446 tests green) | — |
| P2 | `closed/20260711-weekly-planning-preview-policy-stage2-preview-first-decision.md` | decision の preview-first 化 | High | **closed**(2026-07-11 検証: commit `28f4726`・446 tests green) | — |
| I1 | `closed/20260711-weekly-planning-ai-interpretation-stage1-single-interpreter.md` | 意味解釈の AI 一本化(escalation 廃止・毎 turn 解釈) | High | **closed**(commit `ce2713a`・監査済み) | — |
| I1f | `closed/20260711-weekly-planning-i1-followup-pending-creation-and-prompt.md` | I1 追修正(prompt 不整合 + AI 経由 pending 生成) | High | **closed**(commit `2fab00d`) | — |
| I2 | `closed/20260711-weekly-planning-ai-interpretation-stage2-conversation-history.md` | 会話履歴の供給 + reconciliation | High | **closed**(commit `3ad54bf`・監査済み) | — |
| P3 | `closed/20260710-weekly-planning-dialogue-stage2-entry-intent-decision-taxonomy.md` | begin intent + `planning_period` + taxonomy 分離 | High | **closed**(commit `71dbf5c`・2026-07-13 監査で採用可・480 tests green) | — |
| **P4** | `20260710-weekly-planning-dialogue-stage3-goal-acceptance.md`(2026-07-13 追補: planning_period 仮定追跡を最小追加) | `set_study_goal` + legacy fallback 保護 + planning_period 仮定の記録 | Medium | **open・次に実装** | なし(前提はすべて closed) |
| P5〜P9 | 未発行(親設計 v3 §7: 非exam preview bridge / 訂正適用規則(縮小済み P6)/ ActPlan renderer / contract suite。旧 P8 は I1 に吸収) | — | — | 設計のみ | P4 後に切る |

## 2. Deferred(タスクmd化せず backlog 記録)

詳細: `docs/ai/strategy/weekly-planning-deferred-backlog.md`

| ID | 項目 | 優先度 | 着手条件(要約) |
| --- | --- | --- | --- |
| D1 | legacy fallback が constraint 回答を偽タスク化 | Medium | R3 で非 exam draft を許す前に fallback 縮小を先行タスク化 |
| D2 | 非 exam フローの draft dead end(exam prep 専用条件) | Medium | R3 の型設計(unitKind)から |
| D3 | 外側 PlanningState の message 系 dead code | Low | R5 の保存設計と同時に削除/配線を決定 |
| D4 | resolveSchedulingInput の到達不能分岐 | Low | T3 実装時に整理 |
| D5 | clarification ターンの dry-run 実行と decision/preview 整合 | Low | pipeline output 契約の明文化タスクとして R4 前後 |
| D6 | scheduler 二系統統合 | Low | R8。整合設計文書が先 |
| D7 | weeklyPlanningTransforms.ts 解体 | Low | D1・R3 完了後、依存が消えた部分から |

## 3. レビュー問題番号 → 対応先の索引

| レビュー問題 | 内容(1行) | 対応先 |
| --- | --- | --- |
| 問題1 | `set_planning_range` が会話途中で missing を無条件再シードし回答済み情報を再質問 | T1(修正A) |
| 問題2 | explicit range が後続の「一週間」で inferred range に上書き | T1(修正B) |
| 問題3 | confirmedSlots が missing 不在を「確定済み」と誤解釈し AI 候補を silent drop | T2 |
| 問題4 | planning_start_date 質問の renderer 未登録(即時分)/ 質問 slot 定義の分散(本体) | T1(修正C)/ T5 |
| 問題5 | AI 経由 set_planning_range が scheduler window に反映されず pending もバイパス可 | T3 |
| 問題6 | request_clarification が同ターンの accepted commands を全破棄 | T4 |
| 問題7 | legacy fallback の偽タスク生成・非 exam dead end | D1・D2 |
| 問題8 | dead message state / 到達不能分岐 / dry-run 整合 ほか小粒 | D3・D4・D5 |
| (テスト) | 複合ターンのシーム未カバー(405 green のまま全問題が再現) | T6 |

## 4. roadmap との関係

- 本レビューのタスク群は roadmap Phase R2-Capability の診断原則(A〜F)でいう D(intake 可視性: T2)・E(state transition: T1)・F(renderer context: T1/T5)に対応する後続修正であり、R8(capacity)・R3(一般化)の**前**に消化する。
- roadmap §5 末尾「現在オープンなタスクは3本(R2-Capability)」の記述は、当該3本が closed へ移動済みのため既に古い。roadmap の更新は本インデックスの範囲外(次回 roadmap 改訂時に本文書を参照して反映する)。
