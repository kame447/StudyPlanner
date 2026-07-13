# DA0: non-exam StudyTaskScopeをweekly previewへ橋渡しする

Status: **blocked — Gate P4とDA0aの後**
Priority: High
Parent: [weekly-planning-dialogue-architecture-v4.md](../../architecture/weekly-planning-dialogue-architecture-v4.md)
Requirement IDs: DA-INTERPRET-001, DA-PREVIEW-001, DA-FALLBACK-001
Traceability: [weekly-planning-roleplay-test-plan.md](../../testing/weekly-planning-roleplay-test-plan.md)
Dependencies: Gate P4 → DA0a → DA0

## Scope / entry / exit

accepted一般目標、explicit duration、DA0aのcanonical pending proposalをStudyTaskScope → GenericWeeklyWorkItem → existing candidate generator → previewへ渡す。multiple task、priority、eligibility、unscheduled/capability/missing分類、relative rangeの一意解決、exam regressionだけを扱う。

EntryはGate P4完了とDA0aのcanonical pending record/proposalRef contract完了である。Exitはnon-exam explicit/unknown/invalid、proposal参照、pending marker、WeeklyPreviewMetadata/assumptionDependencies、blocked_pending_assumption、preview生成、exam pathが分類・検証されること。

proposal lifecycleはDA0a/DA1b、approval、keyboard、migration、UI overhaul、scheduler全面改修は扱わない。

Current pathはrunWeeklyPlanningIntakePipelineWithInterpreter、weeklyPlanningIntakeReducer.ts、weeklyPlanningDraftRequestAdapter.ts、weeklyDraftCandidateGenerator.ts、既存busy interval/previewである。着手時に実コードを再調査し、架空fileを断定しない。

## Exact domain / state

~~~ts
type GenericWeeklyWorkItem = {
  taskRef: string;
  title: string;
  subject?: string;
  quantity?: {
    amount: number;
    unit: AssumptionUnit;
  };
  durationMinutes?: number;
  assumptionProposalRef?: string;
  priority?: number;
  sourceFactRefs: string[];
  eligibility:
    | "eligible"
    | "eligible_with_pending_assumption"
    | "missing_information"
    | "unsupported"
    | "rejected";
};

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
~~~

validator規則:

- eligibility=eligible_with_pending_assumptionではassumptionProposalRef必須。
- proposalRefは現在user/conversationのstatus=pending proposalを指す。
- proposal targetRefとwork item taskRefが一致する。
- proposal source revisionが有効である。
- accepted/rejected/expired/superseded proposalをpending assumptionとして使わない。
- eligibility=eligibleではassumptionProposalRef不要。
- eligibility=rejectedをpreview candidateへ渡さない。
- explicit durationはfinite positive minutesへ正規化する。
- invalid/zero/negative/oversized/unit外はrejectedにし、他itemを失わない。
- pending assumptionを使った全itemのproposalId/targetRef/created revisionをassumptionDependenciesへ重複なく記録する。
- status=pendingのdependencyが一件でも残るpreviewはapprovalEligibility=blocked_pending_assumptionとする。
- accepted/rejected/expired/superseded、unknown、private、revision不一致dependencyを含むpreviewをeligibleにしない。

preview全体のeligibility、required/available、placement、option ID、WeeklyPreviewMetadataはdeterministic coreが算出する。AIは発行しない。pending assumption付きpreviewは対話材料として表示し、未確定であることをユーザーへ示すが、accepted factとして扱わない。DA0はapprovalEligibility=blocked_pending_assumptionで保存不可を表すところまでを所有し、preview承認をaccept_assumptionへ暗黙変換せず、approval/save operationを開始しない。assumption accept/modify後はrevision更新で旧previewをstaleにし、accepted factによる再計算後の最新previewだけをeligibleにできる。

relative dateはselected date/timezoneからdeterministicに解決する。2026-07-12選択時の「来週」は2026-07-13〜2026-07-19としてacceptedにし、planning periodを再質問しない。一意でない「その辺の週」はclarificationにする。

## Failure / concurrency / persistence / security

title/subject/taskRef/sourceFactRefs、unit、duration/quantity、priority、revision、proposal、WeeklyPreviewMetadata、user scopeをvalidateする。interpreter failure、planner failure、StaleAsyncResultを分離し、candidate generator errorはcapability diagnosticとする。StalePreviewApprovalAttemptとPendingAssumptionPreviewApprovalAttemptの保存境界処理はapproval taskの責務である。

active request一件。session-local proposalと既存draft localStorage契約だけを使う。user text/title/rawTextはuntrusted escaped JSON。save、approval、repository、keyboard、migrationはnon-goalである。

## P1〜P7 responsibility

| Perspective | Applicability | Owning task | Required assertion |
| --- | --- | --- | --- |
| P1 | Covered by another task | DA2 | request/submit lifecycle |
| P2 | Covered by another task | DA2 | IME/focus/keyboard |
| P3 | Applicable | DA0 | hostile item/proposal boundary |
| P4 | Applicable at metadata boundary | DA0、approval | assumptionDependencies、blocked_pending_assumption、pending marker、no save/implicit accept |
| P5 | Not applicable or regression only | future persistence、DA2 | no migration |
| P6 | Applicable | DA0 | range、fallback、exam/non-exam |
| P7 | Applicable | DA0 | item/proposal/preview refs、assumptionDependencies/approvalEligibility trace |

## Acceptance / tests / commands

unitはadapter、eligibility、proposalRef、classification、relative range、WeeklyPreviewMetadata。contractはgenerator boundary、pending marker、assumptionDependencies全件、blocked_pending_assumption、previewId/revision、no save/implicit assumption accept。integrationはexplicit duration、unknown duration + canonical proposalRef → pending preview、multiple items、existing schedule、assumption解決後stale/accepted fact再計算、P6-RANGE-RESOLUTION-001、P3-RANGE-AMBIGUOUS-001、P4-PENDING-ASSUMPTION-SAVE-BLOCK-001のmetadata前提、exam regression。property/fuzzはorder stability、dependency重複、invalid isolation、bounds、stale/non-pending proposal、untrusted strings。

roleplayはWP-DA-001 turns 1、4、9〜9a、WP-RP-001、P6-RANGE-RESOLUTION-001、P4-PENDING-ASSUMPTION-SAVE-BLOCK-001。real-modelはset_study_goal fixture replayのみ。pending preview生成と保存不可metadataまでを検証し、no keyboard、no approval operation、no migrationをassertする。既存test/build/lint、diff check、statusを実行しGit write禁止。
