# User Context

Status: canonical domain index
Updated: 2026-09-12
Owner Issue: #294

このdomainは、アプリ全体で使うdurable user context、semantic/episodic memory、検索、lifecycle/forget、検索した記憶を会話へ出してよいかの判断を所有する。StudyPlannerを開発するエージェントのskills/orchestrationは#212の別scopeであり、ここへ統合しない。

予定、時間割、本棚/StudyMaterial、Actual、週間計画の正式状態など、現在値を管理するdomainを置き換えない。記憶は現在値の第二の正本ではなく、意味理解や会話継続に必要な補助情報である。

## Read order

責務とデータフローは [Memory and conversation architecture](architecture/memory-and-conversation.md)、継続して守るauthority/lifecycle/forget/surfacingは [policy](policies/memory-lifecycle-and-surfacing.md)、品質要件は [Regression scenarios](quality/regression-scenarios.md) を読む。これらのcanonical pathと責任は維持する。

実装インターフェースは [read/writeサービスの詳細設計](architecture/context-service-contract.md) が補足する。これはsupporting target architectureであり、canonical contractの上書きや実装済みの宣言ではない。実行順は [Current roadmap](roadmap/current.md)、ファイル単位の変更・依存・受入条件・rollbackは [段階実装work](work/20260912-context-harness-delivery.md)、最新のactive branch/PRとexact HEADは [Issue #294](https://github.com/kame447/StudyPlanner/issues/294) を参照する。

外部のmanaged harnessを比較する場合は [実行基盤の委譲境界](architecture/managed-execution-boundary.md) を併せて読む。技術的な実行loop・compactionと、アプリのmemory/approval authorityを分離する補助設計である。Agents APIの公式情報、未検証事項、限定実験の採否は [external-integrationsのwork](../external-integrations/work/20260912-managed-agent-runtime-evaluation.md) に集約し、採用済みとは扱わない。

## Core boundary

current structured stateは担当domainの現在の正本、semantic/profile memoryは別の現在値ownerがない再利用可能なユーザー固有の意味、episodic evidenceは時期と出典を持つ過去の根拠、working stateは現在のinteraction/sessionである。回復のため保存した会話状態を、そのまま恒常的なユーザーの好みと解釈しない。

検索に出ることと、現在正しいことと、口に出してよいことは別である。古い記憶で現在値を上書きせず、取得しただけで毎回callbackしない。AIは意味候補を出し、owner、ID、revision、正式な変更、承認、保存はアプリが決める。

## Current state

#232 / PR #235のfoundationが `src/features/userPlanningContext/` にある。自然言語の追加/編集、origin/authority、source-of-truth routing、revoked tombstone、Firestore transaction/revisionを利用する。件数制限付きprompt selectionと、現在のFact Graphから過去の根拠を回収するweekly-planningのepisodic projectionも既存実装であり、ゼロから再実装しない。

PR #302でcanonical文書の導入は完了した。旧documentation branchは削除済みであり、現在の作業queueではない。Phase 0の実コードcharacterization・実測は、設計文書のmergeだけでは完了していない。

共通read/write境界、会話横断の長期episode、包括的な失効伝播、Surface Planner、縦断評価と本番rolloutは、対応コードと検証結果が揃うまでは未完了として扱う。2026-09-12の詳細設計・work追加は文書変更のみである。基準コード、確認できた挙動、未再現の懸念は実装workに分けて記載する。

## Responsibility map

`architecture/` はcanonicalな全体境界とそのsupporting interface設計を持つ。`policies/` はauthority、write、supersession、forget、privacy、surfacingの規則を持つ。`quality/` は縦断・敵対的・会話横断の品質契約を持つ。`roadmap/` は実行順の正本、`work/` は未完了の実装単位と検証計画を持つ。完了したworkは不変条件をcurrent ownerへ移した上でarchiveする。

## Related owners

#47は共有conversation/Fact Graph session、outcome観測・集計・個別最適化を所有し、このdomainの共通contextをconsumeする。#164はlocal/shared authority、操作ID/revision、offline再送、複数端末、migration/rollbackを所有する。両Issueを#294へ丸ごと統合closeしない。

#152 / PR #174はstored/indirect injection、durable poisoning、provenance、renderer securityの検証ownerを維持する。#246は学習相談の提案・review・adoption・promotionを所有し、助言や今回限りの採用をdurable memoryへ無断昇格しない。#213は本文を含まない品質・費用・latencyの観測を担当する。

#187と本棚domainからは現在の教材情報を読む。外部実行サービスの採否・adapterも#187へ接続し、provider sessionを#294や#47の正本にしない。scheduling domainはcompleted #278のScheduleEvent/Occurrence baselineを所有する。#190の明示設定、#51の承認一意性、#45/#89のtrace運用、#128の保存済みpreview互換もそれぞれのownerを維持する。
