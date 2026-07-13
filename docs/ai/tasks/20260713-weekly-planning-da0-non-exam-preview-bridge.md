# DA0: non-exam StudyTaskScope を weekly preview へ橋渡しする

Status: **open — current implementation task**
Priority: High; queue の唯一の open
Parent: docs/architecture/weekly-planning-dialogue-architecture-v4.md
Requirement IDs: DA-INTERPRET-001, DA-PREVIEW-001, DA-FALLBACK-001

## 背景

exam 専用の候補生成と一般学習タスクの intake の間に明示的な橋がなく、set_study_goal の一般目標が preview へ到達できるか、unknown duration をどう扱うかが文書化されていない。

## 目的

一般 task を既存 scheduler/preview に決定的に渡し、未知の duration/quantity は pending assumption として review 可能にする。exam path を壊さず、保存や承認を起動しない。

## 計画書との対応

- spec: §2、§5、§10、§12、§13（該当部分は親設計と P7 表で確定）
- 改善テーマ: 七視点監査 v4 queue

## 対象ファイル

- 変更: src/features/weeklyPlanning/intake、src/features/weeklyPlanning/scheduling/weeklyDraftCandidateGenerator.ts、対応する dialogue/preview test
- 新規: 型/validator/service は task 内で追加してよい
- テスト: unit、contract、integration、property、roleplay fixture

## 現在の処理経路

userText → single interpreter/typed candidates → normalize/validate → adapter → reducer → scheduler/preview。StudyTaskScope と typed candidate の境界で duration、priority、複数 task、missing context の分類が不足している。

## 問題点

- non-exam candidate の型変換、assumption、unscheduled/capability 分類、exam coexistence が task 単位で定義されていない。
- current code は実装状況であり仕様の正ではない。
- AI/rules merge、AI の state/save 直接操作、明示承認なしの hard apply は許可しない。

## 修正方針

StudyTaskScope を検証済みの duration/quantity interpretation に下ろす。未知値は PendingAssumptionProposal、明示値は GenericWeeklyWorkItem として既存 candidate generator/preview に渡す。candidate を merge せず、既存 scheduler の required/available/unscheduled 診断を利用する。

## 型・状態遷移・検証契約

GenericWeeklyWorkItem は taskRef、title/subject/material を untrusted data、priority、quantity/duration、sourceFactRefs、candidate status を持つ。unknown duration は pending、explicit duration は eligible、invalid/overduration は rejected。複数 task は独立 candidate とし、1件の不備で全件を hard apply しないが preview eligibility は deterministic に分類する。

状態遷移は pending → accepted/rejected/superseded/expired のように明示し、暗黙復活を禁止する。全 command は schema、enum、range、NaN/Infinity、size、stateRevision、source fact、authorization を deterministic に検証する。失敗時は partial apply せず、accepted/rejected/pending を保持し、stale preview を無効化する。

## 失敗・concurrency・security

provider unavailable/exception/timeout/parse/schema/unknown ref/action/field、stale request/revision、invalid proposal/correction、unsupported capability は deterministic fallback。fallback 後の追加 AI call と rules/AI merge はしない。conversationId/turnId/requestId は一意、active request は一件、abort/reset/unmount/preview close/history clear は結果を無効化する。全 user-originated string は untrusted JSON data とし、prompt 命令・action/ref/option ID に昇格させず、escaped text のみ描画する。

## persistence・migration

DA0 では session-local candidate/assumption。既存 draft block localStorage と preview ID/revision 契約は維持し、DA0 で保存・承認・migration schema を追加しない。

## 触らない範囲

UI/CSS、repository の実 save、承認副作用、既存 scheduler の全面書換え、複雑 recurrence、sharing、依存追加、src の無関係な未コミット差分。shouldSavePlan=false と明示 save/approval を維持する。

## 受け入れ条件

1. set_study_goal の一般目標が GenericWeeklyWorkItem を経由して preview candidate になる。 2. explicit/unknown duration、複数 task、priority、既存 schedule を分類する。 3. unknown は pending assumption、invalid は rejected、exam path は regression green。 4. no scheduler rewrite、no save/approval、no extra AI call。 5. preview/stale/revision が deterministic。

## P1-P7 試験マトリクス

| 観点 | 必須確認 |
| --- | --- |
| P1 novice | 空入力、double submit、in-flight reset、stale response、retry、次の一問 |
| P2 keyboard | Enter/Shift+Enter/Ctrl+Enter/Meta+Enter、IME、focus、tab、paste |
| P3 malicious | unknown/private/stale ref、invalid values/proposal/correction、injection、AI side effect |
| P4 integrity | partial save/retry/idempotency、source/user IDs、stale preview |
| P5 migration | schemaVersion、破損/未知/上限/日本語/emoji/user-week mismatch、F5 |
| P6 regression | provider absent/exception/timeout/invalid/empty、exam/non-exam、fallback、save/discard |
| P7 traceability | DA-INTERPRET-001, DA-PREVIEW-001, DA-FALLBACK-001 を strict assertion と rubric に紐付ける |

## テスト観点

- unit: schema、state transition、validator、diagnostics。
- contract/integration: pipeline、snapshot、scheduler/preview 境界、fallback。
- property: duplicate、revision、idempotency、untrusted string、size limits。
- roleplay: P1-P7。golden text 完全一致ではなく action/state/factRef/diagnostics と品質 rubric。
- real model evaluation: real model は候補抽出の fixture replay のみ。モデル出力の品質判定は DA3c で行う。

## リスク

既存 exam candidate generator の型に依存しすぎると一般 task が欠落する。adapter と generator の境界をテストで固定する。

## Codexへの実装指示

対象ファイルだけを小さく変更し、既存の安全境界を再利用する。実装前後に src 差分を保護し、npm test/build、git diff --check、status、diff stat を報告する。git add、commit、push、reset、restore、checkout、stash は行わない。docs/ai/codex-task-guide.md に従い、スコープ外の問題は修正せず発見事項として報告する。

