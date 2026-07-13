# Draft approval idempotency: previewからdeterministic saveへ

Status: **queued — DA1b after**
Priority: High
Parent: [weekly-planning-dialogue-architecture-v4.md](../../architecture/weekly-planning-dialogue-architecture-v4.md)
Requirement IDs: DA-IDEMPOTENCY-001, DA-PERSISTENCE-001, DA-PREVIEW-001, DA-SAFE-001
Traceability: [weekly-planning-roleplay-test-plan.md](../../testing/weekly-planning-roleplay-test-plan.md)
Dependencies: DA1b → Draft approval idempotency

## Scope / current path / entry / exit

explicit UI approvalからdraft block repository saveの副作用を、item ledger、source metadata、stale/revision/user/week guard、crash/retryで安全にする。現行preview block、createPlanDraftFromWeeklyDraftBlock、savePlanDraft、localStorage/repository adapterを再調査する。

EntryはDA1b correction/preview stale contract完了。ExitはStalePreviewApprovalAttemptとPendingAssumptionPreviewApprovalAttemptが保存境界で区別され、いずれもledger作成前にdeterministic拒否され、partial failure/retry/duplicate/crashがitem単位で安全なこと。

## Exact types / key

~~~ts
type PreviewAssumptionDependency = {
  proposalId: string;
  targetRef: string;
  proposalCreatedFromStateRevision: number;
};

type WeeklyPreviewApprovalEligibility =
  | "eligible"
  | "blocked_pending_assumption"
  | "blocked_stale"
  | "blocked_invalid"
  | "unsupported";

type WeeklyPreviewMetadata = {
  previewId: string;
  stateRevision: number;
  assumptionDependencies: PreviewAssumptionDependency[];
  approvalEligibility: WeeklyPreviewApprovalEligibility;
};

type PendingAssumptionPreviewApprovalAttempt = {
  kind: "pending_assumption_preview_approval_attempt";
  previewId: string;
  previewStateRevision: number;
  pendingProposalIds: string[];
};

type WeeklyDraftApprovalItemStatus =
  | "pending"
  | "saving"
  | "saved"
  | "failed"
  | "skipped_duplicate";

type WeeklyDraftApprovalItem = {
  sourceDraftBlockId: string;
  status: WeeklyDraftApprovalItemStatus;
  savedPlanId?: string;
  attemptCount: number;
  lastErrorCode?: string;
  updatedAt: string;
};

type WeeklyDraftApprovalOperation = {
  approvalOperationId: string;
  userId: string;
  previewId: string;
  previewStateRevision: number;
  startedAt: string;
  completedAt?: string;
  status: "pending" | "partially_saved" | "completed" | "failed";
  items: WeeklyDraftApprovalItem[];
};

type ApprovedPlanSource = {
  sourceType: "weekly_draft";
  sourceDraftBlockId: string;
  approvalOperationId: string;
};
~~~

idempotency keyはuserId + sourceDraftBlockIdである。approvalOperationIdは監査/batch metadataでkeyに含めない。別operation IDでも同じuser/source blockから二件目のplanを作らない。

## Save-boundary preview eligibility guard

UI buttonの表示/disabled状態だけに依存せず、application/repositoryへ副作用を渡す直前にWeeklyPreviewMetadataをcanonical preview/proposal stateと再検証する。previewId、current revision、stale flag、approvalEligibility、assumptionDependenciesの全proposal ID/target/created revision/status/authorizationを照合する。

判定順は、invalid/unauthorized metadataをblocked_invalid、revision mismatchまたはstale previewをStalePreviewApprovalAttempt、現在revisionと一致するがstatus=pending dependencyが残るpreviewをPendingAssumptionPreviewApprovalAttemptとする。rejected/expired/superseded、unknown、private、revision不一致dependencyをeligibleとして保存しない。assumption accept/modifyは別state transitionでrevisionを進め、旧previewをstaleにする。accepted factを使って再計算した最新previewだけをapprovalEligibility=eligibleにできる。preview承認をaccept_assumptionへ暗黙変換しない。

### StalePreviewApprovalAttempt

stale=true、previewStateRevision不一致、またはcurrent revisionと一致しない古いpreviewのUI承認はStalePreviewApprovalAttemptである。

- saveを拒否する。
- ledger/approval operationを開始しない。
- deterministic user-facing responseで再計算または最新案確認を案内する。
- AI callを行わない。
- silent discardしない。

### PendingAssumptionPreviewApprovalAttempt

preview revisionは現在と一致するがstatus=pendingのassumption dependencyが残るUI承認はPendingAssumptionPreviewApprovalAttemptである。

- pendingProposalIdsへ該当dependencyを全件記録する。
- save、ledger/approval operation、repository writeを開始しない。
- deterministic user-facing responseで、未確定の仮定確認後に最新案を再計算するよう案内する。
- preview承認をassumption承認として扱わない。
- AI callを行わない。
- silent discardしない。

StaleAsyncResultは古いAI responseをDA2がuser-facing messageなしでdiscardする別categoryである。StalePreviewApprovalAttempt、PendingAssumptionPreviewApprovalAttempt、StaleAsyncResultの三者を混同しない。

## State / failure / concurrency / persistence / security

operationはpending→partially_saved/completed/failed、itemはpending→saving→saved/failed/skipped_duplicate。completed retryはno-op、partial retryは未保存/failedだけ。repository既存sourceはexisting planへdedupeする。operation作成前にapprovalEligibility、assumptionDependencies、revision、他user/week、unauthorized block、missing source metadataを再検証し、blocked_pending_assumption/blocked_stale/blocked_invalid/unsupportedを拒否する。

UI optimistic update後repository failureはsaved扱いにしない。crashはledger/source metadataから再照合する。same user/source active saveは一件に直列化する。

ledgerはversionedで、corrupt/unknown/other user/week/size overflowをsafe discardする。会話/request/proposalは自動復元・実行しない。title/memo/source textはuntrusted JSON data。AI、scheduler、interpreter、CSS、auto-save、NL approvalはnon-goalである。

## P1〜P7 responsibility

| Perspective | Applicability | Owning task | Required assertion |
| --- | --- | --- | --- |
| P1 | Covered by another task | DA2 | request/submit lifecycle |
| P2 | Covered by another task | DA2 | IME/focus/keyboard |
| P3 | Applicable | approval | hostile metadata/authorization |
| P4 | Applicable | approval | pending/stale preview分類、save-boundary guard、no ledger/save、idempotency |
| P5 | Applicable | approval | versioned ledger/migration |
| P6 | Regression only | approval | fallback/exam/non-exam |
| P7 | Applicable | approval | preview metadata/dependency/eligibility、attempt category、item/source trace |

## Acceptance / tests / commands

unitはkey derivation、item/operation transitions、status derivation、WeeklyPreviewMetadata、pending/stale/invalid gate。contractはsource metadata、assumptionDependencies status再検証、preview/revision、authorization、deterministic rejection、no implicit accept。integrationはrepository fake partial failure/crash/UI failure/retry、StalePreviewApprovalAttempt、PendingAssumptionPreviewApprovalAttempt、ledger/repository未開始。property/fuzzはduplicate operations、random dependency/status changes、corrupt ledger、untrusted metadata。

roleplayはWP-DA turns 9a、11〜12、P4-PENDING-ASSUMPTION-SAVE-BLOCK-001、P4-STALE-PREVIEW-REJECT-001、P4-PARTIAL-SAVE-001、P5-CORRUPT-STORAGE-001。real-modelはNot applicable。existing tests/build/lint、diff check、docs-only status、Git write禁止。
