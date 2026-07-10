# 週間計画機能 全体レビュー(2026-07-10)成果物インデックス

`src/features/weeklyPlanning/` 全体レビュー(実コード読解 + 実行再現検証。既存テスト 405 件 green のまま全問題が本番経路で再現することを確認済み)の成果物一覧。再調査せずにここから辿れるようにする。

- 全体評価: **次の機能追加(R8 capacity / R3 一般化)前に構造修正が必要**。ただし層構造(parser → command → reducer → dialogue → pipeline → scheduler)自体は健全で、修正は有界。
- 主根本原因: 未コミットの temporal scope 実装が「`set_planning_range` は会話の最初のターンでのみ発火する」「missing に無い slot = 回答済み」という2つの暗黙前提を崩した。
- 管理方法: タスクは従来どおり `docs/ai/tasks/`(完了後 `closed/` へ移動)。優先度はタスクmd冒頭の Priority 表記で管理し、優先度別ディレクトリは作らない。
- 最終更新: 2026-07-10

## 1. タスクmd一覧(実装単位)

| # | タスクmd(docs/ai/tasks/) | レビュー問題 | Priority | 状態 | 依存 |
| --- | --- | --- | --- | --- | --- |
| T1 | `20260710-weekly-planning-range-reseed-guard-and-start-date-render.md` | 問題1(missing 再シード)・問題2(explicit range 上書き)・問題4の登録漏れ | **High**(未コミット temporal scope 差分の regression。コミット前に修正) | open | temporal scope 差分(working tree) |
| T2 | `20260710-weekly-planning-confirmed-slots-semantics.md` | 問題3(confirmedSlots の missing 不在 proxy → silent drop) | **High**(AI モード主要ペルソナで情報が無反応に消え、T1 後も残るため) | open | T1(修正Aの導出 helper を共有) |
| T3 | `20260710-weekly-planning-ai-range-normalization.md` | 問題5(AI 経由 range の calendarDayCount 欠落・pending バイパス) | Medium | open | temporal scope 差分、T1。T2 と同領域のため T2 の後を推奨 |
| T4 | `20260710-weekly-planning-clarification-accepted-orthogonality.md` | 問題6(聞き返しが同ターンの accepted commands を破棄) | Medium | open | なし(T1〜T3 と独立。ただし pipeline 競合回避のため T3 の後を推奨) |
| T5 | `20260710-weekly-planning-question-slot-registry.md` | 問題4本体(質問 slot 定義の5ファイル分散・state.questions の宙吊り) | Medium(挙動変更なしリファクタ。R4 の前提) | open | T1(修正Cの文言を registry へ取り込むため) |
| T6 | `20260710-weekly-planning-multi-slot-turn-regression.md` | テスト網の穴(複合ターンシナリオ不在) | Medium(テストのみ) | open | T1・T2・T4 完了後(T3 は任意) |

**推奨着手順: T1 → T2 → T3 → T4 → T5 → T6。**

- T1・T2 が High: どちらも実行再現済みの対話破壊(再質問ループ / silent drop)で、主要ペルソナ経路に直撃するため。
- T5 は T2〜T4 とファイル競合しにくいが、registry へ転記する文言が T1 修正Cで確定してから行う。
- T6 は修正の受け入れテストを恒久 suite 化するもので、必ず最後(bug を期待値に固定しないため)。
- roadmap の「同時オープンは少数(理想1本)」の運用に対し、本レビュー起点で 6 本 open になる。Codex へは推奨順に1本ずつ渡す。

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
