# 週間計画 AI ロードマップ

Status: **v4 audit-normalized; historical phases retained**
最終更新: 2026-07-14
Current DoR: [weekly-planning-dialogue-architecture-v4.md](../../architecture/weekly-planning-dialogue-architecture-v4.md)
Product goal: [weekly-planning-spec.md](../../weekly-planning/weekly-planning-spec.md)
Canonical roleplay / P7 traceability: [weekly-planning-roleplay-test-plan.md](../../testing/weekly-planning-roleplay-test-plan.md)

## Current queue（この節だけがcurrent statusの正）

origin/mainにGate P4の検証対象とDA0aの実装・テストが含まれ、DA0a branchはmainへ統合済みであることを確認した。Gate P4とDA0aは完了扱いとし、次のopen implementation foundationとしてDA0rを置く。

| 順 | item | status | dependency | Requirement IDs |
| --- | --- | --- | --- | --- |
| 0 | Gate P4 | complete — main verification confirmed | src差分の所有者確認 | DA-GOAL-001、DA-INTERPRET-001、DA-FALLBACK-001 |
| 1 | DA0a assumption proposal foundation | complete — implemented, tested, and merged into main | Gate P4 | DA-ASSUMPTION-001、DA-INTERPRET-001 |
| 2 | DA0r behavior-aware planning readiness foundation | queued | Gate P4、DA0a | DA-READINESS-001、DA-BEHAVIOR-001、DA-RESOLUTION-001 |
| 3 | DA0 non-exam preview bridge | queued | Gate P4、DA0a、DA0r | DA-INTERPRET-001、DA-PREVIEW-001、DA-FALLBACK-001 |
| 4 | DA1 dialogue action/response contract | queued | DA0、DA0r | DA-ACTION-001、DA-RESPONSE-001、DA-FALLBACK-001、DA-SAFE-001、DA-RESOLUTION-001 |
| 5 | DA1b assumption decision and correction contract | queued | DA1 | DA-ASSUMPTION-001、DA-CORRECTION-001、DA-PREVIEW-001 |
| 6 | Draft approval idempotency | queued | DA1b | DA-IDEMPOTENCY-001、DA-PERSISTENCE-001、DA-PREVIEW-001、DA-SAFE-001 |
| 7 | DA2 state-grounded dialogue orchestrator | queued | approval | DA-TURN-001、DA-ACTION-001、DA-FALLBACK-001、DA-PERSISTENCE-001、DA-SAFE-001 |
| 8 | DA3a relative constraint domain | queued | DA2 | DA-RELATIVE-001 |
| 9 | DA3b feasibility consultation | queued | DA3a | DA-FEASIBILITY-001、DA-GOAL-001、DA-PREVIEW-001 |
| 10 | DA3c conversation evaluation | queued | DA3b | DA-EVAL-001、DA-GOAL-001、DA-FALLBACK-001 |

このqueueを旧P4〜P9、T6、D1〜D7、v3 stageへ戻さない。Gate P4とDA0a完了後は、依存関係に従い一度に一件だけopen implementation taskを進める。

## 1. DA0r / DA0a / DA0責務境界

DA0rはPlanningDimension、PlanningReadinessPolicy、PlanningReadinessSnapshot、DraftGenerationIntent、MissingResolutionMode、LifeActivityAnchor、TaskExecutionProfile、PlanningOpportunityAnnotation、PlanningHypothesisSnapshot、preview gate、proposal-first next action policyを所有する。preview block生成、scheduler全面改修、AI response rendering、assumption accept/reject/modify、save、approval、profile永続化、UI/CSSは所有しない。

DA0aはPendingAssumptionProposalDraftのvalidation、deterministic canonicalization、AssumptionProposalRecord status=pending、session-local保持、DA0へのproposalRef handoffまでを所有し、origin/mainで実装・テスト・merge済みである。work item、candidate generator、preview、scheduler、表示、save、approvalは所有しない。

DA0はStudyTaskScopeとcanonical pending proposalをassumptionProposalRef付きGenericWeeklyWorkItemへ変換し、DA0rのreadinessとbehavior derivationを入力に含めてexisting candidate generatorとpreviewへ接続する。eligibility=eligible_with_pending_assumptionでは同じconversation/target/current source revisionのpending proposal参照を必須とする。pending previewの最初のintegration testはDA0に置く。

DA1はPlanningHypothesisSnapshotとAllowedDialogueActionsを入力に含める。DA0r、DA0、DA1、DA1bを一つのvertical sliceとして実装することは許容するが、architecture上の責務、module boundary、test boundaryは分離して記述する。

## 2. 文書の役割・安全境界

roadmapは上位方針でありCodexへ直接渡すtaskではない。task mdはStatus、Priority、Requirement IDs、Dependencies、Entry/Exit、current production path、既存型/関数、候補files/tests、exact types、state transition、validator、failure、concurrency、persistence、security、non-goals、P1〜P7、acceptance、validation commandを持つ。

共通境界はsingle AI interpreter→typed candidates→deterministic normalize/validate/reducer/scheduler/previewである。AI/rules merge、AI save/approve/delete、stale async commit、untrusted stringの命令昇格を禁止する。

AI dialogue responseの使用fact/topic/optionの正はresponsePartsだけである。usedFactRefs、usedQuestionTopicIds、usedOptionIdsはcoreが導出する。formatterはfinite registry key、AI free textは事実値を含まない初期安全契約とする。

StaleAsyncResultはsilent discard、StalePreviewApprovalAttemptはdeterministic user-facing rejectionであり、混同しない。

## 3. Requirement traceability

Requirement ID単位のcanonical表はroleplay test plan §4である。必須IDは次の18件で、各taskのRequirement IDsと本書Current queueを同期する。

DA-GOAL-001、DA-SAFE-001、DA-INTERPRET-001、DA-ACTION-001、DA-TURN-001、DA-ASSUMPTION-001、DA-CORRECTION-001、DA-RESPONSE-001、DA-PREVIEW-001、DA-READINESS-001、DA-BEHAVIOR-001、DA-RESOLUTION-001、DA-RELATIVE-001、DA-FEASIBILITY-001、DA-PERSISTENCE-001、DA-IDEMPOTENCY-001、DA-FALLBACK-001、DA-EVAL-001。

DA-SAFE-001は全task共通の不変条件であり、AI state/save/repository action禁止とexplicit UI approvalを検証する。canonical表でIDの重複、欠落、owner/status不一致をP7-REQUIREMENT-MATRIX-001として検査する。

## 4. R1〜R2のhistorical phases

以下は完了済みまたはhistorical evidenceであり、current queueではない。

### R1 command boundary（closed）

基本導線、parser→command→adapter→reducer、legacy fallbackの隔離、preview生成/表示/承認前状態を整えた。fallback全面撤去は後続課題。

### R2-AI interpreter/renderer（closed）

candidate validator、structured response、deterministic renderer fallback、provider接続、single interpreter、会話履歴を段階的に整備した。provider経路でdeterministic semantic parserを並列mergeしない。

### R2-S correctness（closed）

yearRange保護、existing plans/timetable busy interval、life constraint展開、sleep/study start分離、7日目予備日、atomic work unit、preview個別削除、質問計画を回帰として固定した。capacity超過、明示duration、daily/weekday/weekend target、calendar intakeは長期候補。

### R2-Capability（historical）

既存予定・時間割のscheduling capabilityはあるがintakeが利用可能性を知らない非対称を確認した。発話ごとの専用state/commandではなく、semantic intent、capability snapshot、deterministic planner decision、renderer contextへ分ける根拠を残した。

## 5. R3〜R8 long-term historical roadmap

以下はlong-term directionであり、Current queueのtaskを前倒ししない。

### R3 進捗単位一般化

examのfield×year固定からunitKind（exam_year、page、word_count、problem_number、report_stage）へ段階拡張する。TaskProgressScope、remaining work item、明示duration/quantity、progress更新を互換helperで導入し、yearRangeを一度に削除しない。DA0はnon-exam previewの最小slice、一般化はR3。

### R4 質問計画

DA0rでMissingResolutionMode、PlanningHypothesisSnapshot、proposal-first policyのfoundationを先行する。spec §6の影響×不確実性−質問コストをpolicyへ落とし、1 turn 1〜3問、選択肢、分からないassumption、no-reaskを実装する。v4のaskedTopicHistory/activeQuestionは既存の型基盤として維持し、評価/UI接続は後続。

### R5 生活profile

睡眠、食事、予定種別buffer、確認履歴をconfidence/lastConfirmedAt/source付きで扱う。今回のamendmentでは初期状態をsession-localとし、recurring profileへの昇格、保存先、保持期間、会話履歴の扱いは明示同意を含む別判断とする。

### R6 実績・見積もり補正

予定/実績時間、進捗位置、体感を記録し、estimateBiasとscheduleAdherenceを混ぜずに計算する。R3後にremaining workへ接続し、MLでstateを直接更新しない。

### R7 再計画

予定変更、実績乖離、削除、締切影響、未達をdeterministic trigger化する。30分以上の削除、締切影響、反復削除だけ理由を聞き、未承認draftを再配置する。

### R8 配置品質・scheduler整合

6日ベース配分、通常上限1.5倍、7日目予備日、集中時間帯、重い課題の長い枠、休憩をcandidate generatorへ段階導入する。old/new schedulerの統合はbusy interval型の整合設計とregression後に行い、第三のavailability概念を作らない。

## 6. D1〜D7と延期理由

D1 fallbackの偽task化、D2 non-exam dead end、D3 message state二重化、D4到達不能分岐、D5 clarification/dry-run不整合、D6 scheduler二系統、D7 transforms解体はdeferred-backlogに具体的根拠、priority、start condition、今触らない理由を残す。これらはcurrent queueではない。

延期理由は、fallback縮小前にD2を一般化するとstate汚染がpreviewへ入ること、scheduler統合が最高リスクであること、会話履歴保存やprofile保存にproduct判断が必要なこと、year固定型の全面migrationを避けることである。

## 7. 今やらないこと・リスク

scheduler全面改修、UI/CSS大改修、自動保存、complex recurrence、sharing、state全面置換、yearRange削除、ML/LLMによるstate直接更新、LangGraph導入、未承認のprovider接続を行わない。task実装中に別問題を見つけたらscope外として報告し、roadmap/task候補へ戻す。
