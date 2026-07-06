# scope parser の誤解釈修正(「1年分は3時間」の totalYears 誤取得)

継続対話スモークで確認された、決定的 scope parser の誤動作を修正する。intended behavior 変更として red → green で進める。

> **訂正(2026-07-05)**: 当初は「yearRange 単独入力でも examPrepScope を新規生成する」修正(旧・問題2)を本タスクに含めていたが、**取り下げる**。実装検証で foundation テスト3件が落ち、原因調査により次の実害が確認されたため: (a) yearRange 単独の**部分進展**が escalation の「進展あり」判定を満たして AI 呼び出しを抑止し、決定的 parser では抽出できない fields・priority order の抽出機会を失わせる。(b) 部分 scope の確定により `confirmedSlots` に `exam_scope` / `year_range` が入り、AI の完全な `set_exam_scope` が `confirmed-slot-overwrite` で拒否されうる。yearRange 単独入力は**scope を新規生成せず AI escalation に委ねる現行方針を維持**する(既存 scope への yearRange merge は従来から動作しており変更不要)。将来の再設計条件は R2-C-eval の発見事項を参照。**既に実装済みの場合、ガードへの yearRange 追加(および yearRange 単独生成に関わる変更)は revert すること。**

**R2-D の着手条件**: candidate ラッパー簡素化(`20260705-weekly-planning-candidate-wrapper-simplification.md`)と本タスクが完了し、継続対話スモークで exam scope と unit rate が両立することを確認してから。

本mdの範囲外へ進まない。git add / commit / push はしない。

## 背景(調査で確定済み)

### 問題1: 単価回答が phantom exam scope を作る

「1年分は3時間くらいです。」に含まれる「年分」が `hasExamScopeSignal` に引っかかり、`parseTotalYears` が「1年分」を **totalYears = 1** と解釈。fields 空・yearRange なしの phantom examPrepScope が生成され、apply が `tasks_or_goals` を missing から除去し、`year_range` を missing に追加した(実会話で「学習内容や目標」が消え「対象年度」が復活した直接原因)。さらに現行の merge は `totalYears = parseTotalYears(text) ?? previousScope?.totalYears` のため、**既存 scope の totalYears 7 を 1 で上書きする**破壊も起きうる。

### (取り下げ済み)旧・問題2: yearRange 単独入力

「2025〜2019までそれぞれある」のような yearRange 単独入力は決定的 parser では scope にならないが、これは**取り下げ理由(冒頭の訂正参照)により現行方針のまま維持**する。実会話で年度が失われた本来の原因は AI 応答の契約違反であり、candidate ラッパー簡素化(別タスク)が直れば AI が yearRange を含む完全な scope を返すため、決定的側の単独生成は不要。

## 実装内容

1. **単価文脈の除外**: 「N年分」が単価表現の一部(例: 「1年分は3時間」「1年分あたり◯分」— 同一 segment 内で duration が続く形)である場合、`parseTotalYears` の結果として扱わない。除外の判定は既存 unit rate parser のパターンと整合させる(重複実装を避け、共通の判定 helper を検討してよい)。あわせて「単価回答が既存 scope の totalYears を上書きしない」ことを保証する。
2. **(訂正)yearRange 単独生成はしない**: `mergeExamPrepScope` の生成ガードは従来のまま(yearRange を判定に加えない)。既に加えてしまっている場合は revert する。

## 回帰テスト(red → green)

- **実会話の再現**: 既存 exam scope(totalYears 7・yearRange あり)を持つ state に「1年分は3時間くらいです。」を与えたとき、(a) totalYears が 7 のまま(1 に上書きされない)、(b) unit rate 180分・uncertainty medium が受理される、(c) `tasks_or_goals` / `year_range` の missing が変動しない。
- scope が**ない** state に「1年分は3時間くらいです。」を与えたとき、phantom scope が作られないこと(examPrepScope undefined のまま)。※この場合 unit rate は文脈条件を満たさず受理されないが、それは現行仕様どおり(AI 経路または slot filling が受け皿)。挙動を観察して固定する。
- **(差し替え)yearRange 単独入力の現行方針の固定**: scope が**ない** state に「2025〜2019までそれぞれある」を与えても examPrepScope が生成されない(undefined のまま)こと。あわせて、この種の長文ターンで escalation の前提(決定的 command 0件)が保たれることは foundation テスト3件(fake interpreter 呼び出し系)が green のままであることで担保する。既存 scope がある場合に yearRange が merge されることは従来挙動として1件固定してよい(現行で green のはず)。
- 既存の exam scope 系テスト(「今週末で院試過去問の残りを進めたい」「7年分は2019〜2025」等)がすべて期待値変更なしで green。

## 対象ファイル候補

- `src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts`
- `src/features/weeklyPlanning/__tests__/weeklyPlanningIntakeEdgeCases.test.ts`(回帰テスト追加)
- 判定 helper を共有する場合のみ `weeklyPlanningUnitRateParsing.ts`(パターンの共通化。挙動変更なし)

## 触らない範囲 / 停止条件

- 年度範囲「から〜まで」対応(R2初期-3 の別タスク)、AI interpreter / schema、renderer、UI、escalation、missing 判定の構造。
- `ExamPrepScope` 型の変更。
- 修正が scopeParsing(+共通 helper)の範囲で収まらないと判明したら停止して報告。

## 検証(Node 22)

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/__tests__/weeklyPlanningIntakeEdgeCases.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```
