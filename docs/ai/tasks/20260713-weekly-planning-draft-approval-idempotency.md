# Draft approval idempotency: previewからdeterministic saveへ

Status: **queued — DA1b after**
Priority: High
Parent: [weekly-planning-dialogue-architecture-v4.md](../../architecture/weekly-planning-dialogue-architecture-v4.md)
Requirement IDs: DA-IDEMPOTENCY-001, DA-PERSISTENCE-001, DA-PREVIEW-001, DA-SAFE-001
Traceability: [weekly-planning-roleplay-test-plan.md](../../testing/weekly-planning-roleplay-test-plan.md)
Dependencies: DA1b → Draft approval idempotency

## Scope / current path / entry / exit

explicit UI approvalからdraft block repository saveの副作用を、item ledger、source metadata、stale/revision/user/week guard、crash/retryで安全にする。現行preview block、createPlanDraftFromWeeklyDraftBlock、savePlanDraft、localStorage/repository adapterを再調査する。

EntryはDA1b correction/preview stale contract完了。ExitはStalePreviewApprovalAttemptがledger作成前にdeterministic拒否され、partial failure/retry/duplicate/crashがitem単位で安全なこと。

## Exact types / key

~~~ts
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

## StalePreviewApprovalAttempt

stale=true、previewStateRevision不一致、またはcurrent revisionと一致しない古いpreviewのUI承認はStalePreviewApprovalAttemptである。

- saveを拒否する。
- ledger/approval operationを開始しない。
- deterministic user-facing responseを表示する。
- 現在条件と一致せず、そのまま保存できず、再計算または最新案確認が必要という意味を満たす。
- AI callを行わない。
- silent discardしない。

StaleAsyncResultはDA2が無言discardする別categoryである。両者を同じstale処理にしない。

## State / failure / concurrency / persistence / security

operationはpending→partially_saved/completed/failed、itemはpending→saving→saved/failed/skipped_duplicate。completed retryはno-op、partial retryは未保存/failedだけ。repository既存sourceはexisting planへdedupeする。revision mismatch、他user/week、unauthorized block、missing source metadataも拒否する。

UI optimistic update後repository failureはsaved扱いにしない。crashはledger/source metadataから再照合する。same user/source active saveは一件に直列化する。

ledgerはversionedで、corrupt/unknown/other user/week/size overflowをsafe discardする。会話/request/proposalは自動復元・実行しない。title/memo/source textはuntrusted JSON data。AI、scheduler、interpreter、CSS、auto-save、NL approvalはnon-goalである。

## P1〜P7 responsibility

| Perspective | Applicability | Owning task | Required assertion |
| --- | --- | --- | --- |
| P1 | Covered by another task | DA2 | request/submit lifecycle |
| P2 | Covered by another task | DA2 | IME/focus/keyboard |
| P3 | Applicable | approval | hostile metadata/authorization |
| P4 | Applicable | approval | stale preview、save、idempotency |
| P5 | Applicable | approval | versioned ledger/migration |
| P6 | Regression only | approval | fallback/exam/non-exam |
| P7 | Applicable | approval | preview/item/source trace |

## Acceptance / tests / commands

unitはkey derivation、item/operation transitions、status derivation、stale gate。contractはsource metadata、preview/revision、authorization、deterministic rejection。integrationはrepository fake partial failure/crash/UI failure/retry、StalePreviewApprovalAttempt。property/fuzzはduplicate operations、random order、corrupt ledger、untrusted metadata。

roleplayはWP-DA turns 11〜12、P4-STALE-PREVIEW-REJECT-001、P4-PARTIAL-SAVE-001、P5-CORRUPT-STORAGE-001。real-modelはNot applicable。existing tests/build/lint、diff check、docs-only status、Git write禁止。
