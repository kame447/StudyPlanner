# 週間計画 AI ロードマップ

Status: **v4 audit-normalized; historical phases retained**
最終更新: 2026-07-13
Current DoR: ../../architecture/weekly-planning-dialogue-architecture-v4.md
Product goal: ../../weekly-planning/weekly-planning-spec.md

## Current queue（この節だけがcurrent statusの正）

Gate P4が完了するまでopen implementation taskはない。Gate P4は実装taskではなく、既存P4由来差分の採否・検証を行うactive verification gateである。

| 順 | item | status | dependency |
| --- | --- | --- | --- |
| 0 | Gate P4 | active verification gate | src差分の所有者確認 |
| 1 | DA0a assumption proposal foundation | blocked — Gate P4 verification後 | Gate P4 |
| 2 | DA0 non-exam preview bridge | blocked — Gate P4とDA0aの後 | DA0a |
| 3 | DA1 dialogue action/response contract | queued | DA0 |
| 4 | DA1b assumption decision and correction contract | queued | DA1 |
| 5 | Draft approval idempotency | queued | DA1b |
| 6 | DA2 state-grounded dialogue orchestrator | queued | approval |
| 7 | DA3a relative constraint domain | queued | DA2 |
| 8 | DA3b feasibility consultation | queued | DA3a |
| 9 | DA3c conversation evaluation | queued | DA3b |

このqueueを旧P4〜P9、T6、D1〜D7、v3 stageへ戻さない。Gate P4後に一度に一件だけimplementation taskを進める。

## 1. 文書の役割・安全境界

roadmapは上位方針でありCodexへ直接渡すtaskではない。task mdはStatus、Priority、Requirement IDs、Dependencies、Entry/Exit、current production path、既存型/関数、候補files/tests、exact types、state transition、validator、failure、concurrency、persistence、security、non-goals、P1〜P7、acceptance、validation commandを持つ。Git writeは行わない。

共通境界はsingle AI interpreter→typed candidates→deterministic normalize/validate/reducer/scheduler/preview。AI/rules merge、AI save/approve/delete、stale response commit、untrusted stringの命令昇格を禁止する。

## 2. R1〜R2のhistorical phases

### R1 command boundary（closed）

基本導線、parser→command→adapter→reducer、legacy fallbackの隔離、preview生成/表示/承認前状態を整えた。fallback全面撤去は後続課題。

### R2-AI interpreter/renderer（closed）

candidate validator、structured response、deterministic renderer fallback、provider接続、single interpreter、会話履歴を段階的に整備した。provider経路でdeterministic semantic parserを並列mergeしない。

### R2-S correctness（closed）

yearRange保護、existing plans/timetable busy interval、life constraint展開、sleep/study start分離、7日目予備日、atomic work unit、preview個別削除、質問計画を回帰として固定した。capacity超過、明示duration、daily/weekday/weekend target、calendar intakeは長期候補。

### R2-Capability（historical）

既存予定・時間割のscheduling capabilityはあるがintakeが利用可能性を知らない非対称を確認した。発話ごとの専用state/commandではなく、semantic intent、capability snapshot、deterministic planner decision、renderer contextへ分ける根拠を残した。

## 3. R3〜R8 long-term historical roadmap

### R3 進捗単位一般化

examのfield×year固定からunitKind（exam_year、page、word_count、problem_number、report_stage）へ段階拡張する。TaskProgressScope、remaining work item、明示duration/quantity、progress更新を互換helperで導入し、yearRangeを一度に削除しない。DA0はnon-exam previewの最小slice、一般化はR3。

### R4 質問計画

spec §6の影響×不確実性−質問コストをpolicyへ落とし、1turn 1〜3問、選択肢、分からないassumption、no-reaskを実装する。v4のaskedTopicHistory/activeQuestionは型の先行基盤であり、評価/UI接続は後続。

### R5 生活profile

睡眠、食事、予定種別buffer、確認履歴をconfidence/lastConfirmedAt/source付きで保持する。保存先、保持期間、会話履歴の扱いはユーザー判断を先に取る。

### R6 実績・見積もり補正

予定/実績時間、進捗位置、体感を記録し、estimateBiasとscheduleAdherenceを混ぜずに計算する。R3後にremaining workへ接続し、MLでstateを直接更新しない。

### R7 再計画

予定変更、実績乖離、削除、締切影響、未達をdeterministic trigger化する。30分以上の削除、締切影響、反復削除だけ理由を聞き、未承認draftを再配置する。

### R8 配置品質・scheduler整合

6日ベース配分、通常上限1.5倍、7日目予備日、集中時間帯、重い課題の長い枠、休憩をcandidate generatorへ段階導入する。old/new schedulerの統合はbusy interval型の整合設計とregression後に行い、第三のavailability概念を作らない。

## 4. D1〜D7と延期理由

D1 fallbackの偽task化、D2 non-exam dead end、D3 message state二重化、D4到達不能分岐、D5 clarification/dry-run不整合、D6 scheduler二系統、D7 transforms解体はdeferred-backlogに具体的根拠、priority、start condition、今触らない理由を残す。これらはcurrent queueではない。

延期理由は、fallbackの縮小前にD2を一般化するとstate汚染がpreviewへ入ること、scheduler統合が最高リスクであること、会話履歴保存やprofile保存にproduct判断が必要なこと、year固定型の全面migrationを避けることである。

## 5. 今やらないこと・リスク

scheduler全面改修、UI/CSS大改修、自動保存、complex recurrence、sharing、state全面置換、yearRange削除、ML/LLMによるstate直接更新、LangGraph導入、未承認のprovider接続を行わない。task実装中に別問題を見つけたらscope外として報告し、roadmap/task候補へ戻す。
