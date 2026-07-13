# DA1b: assumption decision and correction contract

Status: **queued — DA1 after**
Priority: High
Parent: [weekly-planning-dialogue-architecture-v4.md](../../architecture/weekly-planning-dialogue-architecture-v4.md)
Requirement IDs: DA-ASSUMPTION-001, DA-CORRECTION-001, DA-PREVIEW-001
Traceability: [weekly-planning-roleplay-test-plan.md](../../testing/weekly-planning-roleplay-test-plan.md)
Dependencies: DA1 → DA1b

正式責務名はassumption decision and correction contractである。旧来のcorrectionだけのtaskとして扱わない。

## Scope / entry / exit

pending proposalのaccept/reject/modify/expiry/supersede、target resolution、replace/remove/supersede/restore、audit history、preview stale、scheduler triggerを扱う。現行command types、candidate validator、intake adapter/reducerを再調査し全面置換しない。

EntryはDA1 action/response contract完了。Exitはproposal lifecycle recordが監査可能で、decisionとtargetがdiscriminated unionになり、replacementが具体型で、Envelope atomic・turn内独立がcontract testで固定されること。

## Exact types

~~~ts
type AssumptionDecisionCommand =
  | {
      type: "accept_assumption";
      proposalId: string;
      expectedStateRevision: number;
      confidence: Confidence;
      sourceText: string;
    }
  | {
      type: "reject_assumption";
      proposalId: string;
      expectedStateRevision: number;
      confidence: Confidence;
      sourceText: string;
    }
  | {
      type: "modify_assumption";
      proposalId: string;
      replacementValue: AssumptionValue;
      replacementUnit?: AssumptionUnit;
      expectedStateRevision: number;
      confidence: Confidence;
      sourceText: string;
    };

type CorrectionTarget =
  | { kind: "fact"; factId: string }
  | { kind: "proposal"; proposalId: string }
  | { kind: "command"; commandId: string }
  | { kind: "task"; taskRef: string }
  | { kind: "event"; eventRef: string }
  | { kind: "slot"; slot: PlanningAssumptionSlot };

type ValidatedCorrectionReplacement = Exclude<
  ParsedWeeklyPlanningCommand,
  {
    type: "begin_weekly_planning" | "request_clarification";
  }
>;

type CorrectionEnvelopeBase = {
  correctionId: string;
  target: CorrectionTarget;
  sourceText: string;
  confidence: Confidence;
  expectedStateRevision: number;
};

type CorrectionEnvelope =
  | (
      CorrectionEnvelopeBase & {
        operation: "replace";
        replacementCommand: ValidatedCorrectionReplacement;
      }
    )
  | (
      CorrectionEnvelopeBase & {
        operation: "remove" | "supersede" | "restore";
        replacementCommand?: never;
      }
    );
~~~

現行validatorはaccepted commandをParsedWeeklyPlanningCommandとして返すため、そのunionを再利用する。correction replacementではstate mutationでないbegin_weekly_planningとrequest_clarificationを除外する。raw AI JSONやacceptedWithConfirmationをreplacementとしてatomic applyしない。

## Lifecycle / validator / atomicity

proposal transitionはpending → accepted/rejected/superseded/expired。modifyは旧recordをsuperseded、新recordをpendingにし、supersededByProposalId、decidedAtTurnId、decidedAtStateRevisionを記録する。元recordを削除しない。rejected/expiredを暗黙にpendingへ戻さない。

accept/rejectにreplacementValue禁止、modifyはreplacementValue必須。unknown proposal ID、non-pending重複decision、revision mismatch、別user/conversation/targetはそのdecisionだけrejectする。

CorrectionTargetは型上ちょうど一種類で、空target・複数targetを禁止する。replaceはreplacement必須。remove/supersede/restoreはreplacement禁止。restoreは復元可能なsuperseded target必須。

一つのCorrectionEnvelope内部はatomic。同turnの複数Envelopeは独立validateし、accepted correctionとrejected correctionを共存可能にする。accepted commandとclarificationを直交保持し、rejected correctionは元factを壊さない。accepted後はrevisionを進めpreviewをstale化しscheduler/feasibilityを再計算する。

schema/enum/finite/range/size/status/sourceFactRefs/revision/authorization/target uniquenessをdeterministic検証する。interpreter/planner/StaleAsyncResultはDA1/DA2 categoryへ委譲。active request一件、session-local。sourceText/reason/title/memoはuntrusted JSON data。save/repository/UI/scheduler全面改修はnon-goalである。

## P1〜P7 responsibility

| Perspective | Applicability | Owning task | Required assertion |
| --- | --- | --- | --- |
| P1 | Covered by another task | DA2 | request/submit lifecycle |
| P2 | Covered by another task | DA2 | IME/focus/keyboard |
| P3 | Applicable | DA1b | decision/target/replacement boundary |
| P4 | Covered by another task | approval | stale preview approval/idempotency |
| P5 | Not applicable or regression only | future persistence、DA2 | migration scope |
| P6 | Applicable | DA1b | fallbackとexam/non-exam |
| P7 | Applicable | DA1b | lifecycle、target、revision trace |

## Acceptance / tests / commands

unitはAssumptionProposalRecord lifecycle、decision union、target union、typed replacement、confidence/revision/audit。contractはmultiple envelopes independent、Envelope atomic、clarification orthogonal、preview stale。integrationはWP-DA turns 3〜6、10、scheduler trigger、exam regression。property/fuzzはinvalid union shapes、unknown/non-pending IDs、duplicates、NaN/Infinity、cross-user/conversation、untrusted strings。

roleplayはturn 5a/5b/5c、turn 6 range correction、turn 10、P3-CORRECTION-TARGET-001、P3-ASSUMPTION-DECISION-001。real-modelはcommand fixture replay。既存test/build/lint、diff check、status、Git write禁止。
