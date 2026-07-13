# Draft approval idempotency: previewからdeterministic saveへ

Status: **queued — DA1b after**
Priority: High
Parent: ../../architecture/weekly-planning-dialogue-architecture-v4.md
Requirement IDs: DA-IDEMPOTENCY-001, DA-PERSISTENCE-001, DA-PREVIEW-001
Dependencies: DA1b

## Scope / current path / entry / exit

explicit UI approvalからdraft block repository saveの副作用を、item ledger、source metadata、stale/revision/user/week guard、crash/retryで安全にする。現行preview block、`createPlanDraftFromWeeklyDraftBlock`、`savePlanDraft`、localStorage/repository adapterを再調査する。EntryはDA1b correction/preview contract。Exitはpartial failure/retry/duplicate/crashがitem単位で安全なこと。

## Exact types / key

```ts
type WeeklyDraftApprovalItemStatus =
  | "pending" | "saving" | "saved" | "failed" | "skipped_duplicate";
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
```

idempotency keyは **userId + sourceDraftBlockId**。approvalOperationIdは監査/batch metadataで、keyに含めない。別operation IDでも同じuser/source blockから二件目のplanを作らない。

## State / failure / concurrency / persistence / security

operationはpending→partially_saved/completed/failed、itemはpending→saving→saved/failed/skipped_duplicate。completed retryはno-op、partial retryは未保存/failedだけ。repository既存sourceはexisting planへdedupeする。stale preview、revision mismatch、他user/week、unauthorized block、missing source metadataは拒否。UI optimistic update後repository failureはsaved扱いにしない。crashはledger/source metadataから再照合。same user/source active saveは一件に直列化する。

ledgerはversioned、corrupt/unknown/other user/week/size overflowをsafe discard。会話/request/proposalは自動復元・実行しない。title/memo/source textはuntrusted JSON data。AI、scheduler、interpreter、CSS、auto-save、NL approvalはnon-goal。

## P1〜P7 responsibility

| Perspective | Applicability | Owning task | Required assertion |
| --- | --- | --- | --- |
| P1 | Covered by another task | DA2 | request/submit lifecycle |
| P2 | Covered by another task | DA2 | IME/focus/keyboard |
| P3 | Applicable | approval | hostile/invalid boundary |
| P4 | Applicable | approval | preview/save/idempotency |
| P5 | Applicable | approval | migration scope |
| P6 | Regression only | approval | fallback and exam/non-exam |
| P7 | Applicable | approval | typed refs/revision/diagnostics trace |



## Acceptance / tests / commands

unit: key derivation、item/operation transitions、status derivation。contract: source metadata、preview/revision、authorization。integration: repository fake partial failure/crash/UI failure/retry。property/fuzz: duplicate operations、random order、corrupt ledger、untrusted metadata。roleplay: WP-DA turn 12、P4/P5/P6。real-modelはNot applicable。existing tests/build/lint、diff check、docs-only status、Git write禁止。
