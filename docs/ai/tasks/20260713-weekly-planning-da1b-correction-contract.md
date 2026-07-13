# DA1b: assumption decision and correction contract

Status: **queued — DA1 after**
Priority: High
Parent: [weekly-planning-dialogue-architecture-v4.md](../../architecture/weekly-planning-dialogue-architecture-v4.md)
Requirement IDs: DA-ASSUMPTION-001, DA-CORRECTION-001, DA-PREVIEW-001
Traceability: [weekly-planning-roleplay-test-plan.md](../../testing/weekly-planning-roleplay-test-plan.md)
Dependencies: DA1 → DA1b

正式責務名はassumption decision and correction contractである。旧来のcorrectionだけのtaskとして扱わない。

## Scope / entry / exit

pending proposalのaccept/reject/modify/expiry/supersede、accepted correctionによる関連pending proposal resolution、target resolution、replace/remove/supersede/restore、audit history、preview stale、scheduler triggerを扱う。現行command types、candidate validator、intake adapter/reducerを再調査し全面置換しない。

EntryはDA1 action/response contract完了。ExitはreasonCodeを保持するproposal lifecycle recordとresolvedByが監査可能で、decisionとtargetがdiscriminated unionになり、replacementが具体型で、correction applyと関連proposal resolutionのatomicity・Envelope間独立がcontract testで固定されること。

## Exact types

~~~ts
type ProposalResolutionRef =
  | { kind: "proposal"; proposalId: string }
  | { kind: "fact"; factId: string }
  | { kind: "correction"; correctionId: string };

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

proposal transitionはpending → accepted/rejected/superseded/expired。acceptedはaccept_assumptionでproposal値をaccepted factへ移した状態、rejectedは明示拒否、supersededは同じtarget/slotの新しい明示値または新proposalによる直接置換、expiredはsource fact、target、planning range、task scopeが直接replacementなしに無効になった状態である。modifyは旧recordをsuperseded、新recordをpendingにし、decidedAtTurnId、decidedAtStateRevision、resolvedBy={kind:"proposal", proposalId}を記録する。reasonCodeを含む元recordを削除せず、rejected/expired/supersededを暗黙にpendingへ戻さない。

accept/rejectにreplacementValue禁止、modifyはreplacementValue必須。unknown proposal ID、non-pending重複decision、revision mismatch、別user/conversation/targetはそのdecisionだけrejectする。

CorrectionTargetは型上ちょうど一種類で、空target・複数targetを禁止する。replaceはreplacement必須。remove/supersede/restoreはreplacement禁止。restoreは復元可能なsuperseded target必須。

一つのCorrectionEnvelope内部はatomic。同turnの複数Envelopeは独立validateし、accepted correctionとrejected correctionを共存可能にする。accepted commandとclarificationを直交保持し、rejected correctionは元factとproposal statusを壊さない。

accepted correctionをapplyする同じdeterministic transitionで、status=pendingかつproposal.targetRef/slotが訂正対象と一致するもの、またはsourceFactRefsのいずれかが訂正・supersedeされたものを検索する。同target/slotへ新しい明示値がacceptedされたproposalはsuperseded、前提・target・scopeだけが直接replacementなしに無効化されたproposalはexpiredとする。decidedAtTurnId、decidedAtStateRevision、resolvedByのcorrection IDまたはreplacement fact IDを記録し、履歴を削除せずpending viewから除外する。old proposalへのaccept/reject/modifyはnon-pending decisionとして拒否する。無関係proposalは不変で、correction applyとproposal resolutionのどちらかだけをcommitしない。

accepted decision/correction後はrevisionを進め、依存previewをstale化し、assumptionDependenciesを再評価してscheduler/feasibilityを再計算する。assumption accept/modify後もaccepted factから最新previewを再計算し、旧previewをeligibleへ戻さない。

schema/enum/finite/range/size/status/reasonCode/sourceFactRefs/revision/authorization/target uniquenessをdeterministic検証する。reasonTextはDA0a/DA1でschema rejectされ、DA1bはvalidated reasonCodeを履歴に保持する。interpreter/planner/StaleAsyncResultはDA1/DA2 categoryへ委譲。active request一件、session-local。sourceText/title/memoはuntrusted JSON data。save/repository/UI/scheduler全面改修はnon-goalである。

## P1〜P7 responsibility

| Perspective | Applicability | Owning task | Required assertion |
| --- | --- | --- | --- |
| P1 | Covered by another task | DA2 | request/submit lifecycle |
| P2 | Covered by another task | DA2 | IME/focus/keyboard |
| P3 | Applicable | DA1b | decision/target/replacement、correction-proposal resolution boundary |
| P4 | Shared transition boundary | DA1b、approval | proposal解決でpreview stale、保存guardはapproval |
| P5 | Not applicable or regression only | future persistence、DA2 | migration scope |
| P6 | Applicable | DA1b | fallbackとexam/non-exam |
| P7 | Applicable | DA1b | lifecycle、reasonCode、resolvedBy、target、revision trace |

## Acceptance / tests / commands

unitはAssumptionProposalRecord lifecycle、ProposalResolutionRef、superseded/expired分類、decision union、target union、typed replacement、confidence/revision/audit。contractはcorrection apply + related proposal resolution atomic、multiple envelopes independent、old proposal decision拒否、unrelated proposal不変、clarification orthogonal、assumptionDependencies再評価、preview stale。integrationはWP-DA turns 3〜6、10、P3-CORRECTION-SUPERSEDES-PROPOSAL-001、scheduler trigger、exam regression。property/fuzzはinvalid union shapes、unknown/non-pending IDs、duplicates、source invalidation、NaN/Infinity、cross-user/conversation、untrusted strings。

roleplayはturn 5a/5b/5c、turn 6 range correction、turn 10の90分proposal supersede、P3-CORRECTION-TARGET-001、P3-CORRECTION-SUPERSEDES-PROPOSAL-001、P3-ASSUMPTION-DECISION-001。real-modelはcommand fixture replay。既存test/build/lint、diff check、status、Git write禁止。
