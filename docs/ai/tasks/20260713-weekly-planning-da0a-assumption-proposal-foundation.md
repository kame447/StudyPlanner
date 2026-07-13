# DA0a: assumption proposal foundation

Status: **blocked — Gate P4 verification後**
Priority: High
Parent: [weekly-planning-dialogue-architecture-v4.md](../../architecture/weekly-planning-dialogue-architecture-v4.md)
Requirement IDs: DA-ASSUMPTION-001, DA-INTERPRET-001
Traceability: [weekly-planning-roleplay-test-plan.md](../../testing/weekly-planning-roleplay-test-plan.md)
Dependencies: Gate P4 → DA0a → DA0

## Scope / entry / exit

AIのproposal draftをdeterministic coreがcanonicalなpending recordへ変換する最小基盤である。

Entry:

- Gate P4の採否と既存src差分の所有者確認が完了している。
- 現行interpreter、candidate validator、adapter/reducer、session-local stateの接続点を再調査済みである。

Exit:

- PendingAssumptionProposalDraftをvalidateする。
- deterministic coreがAssumptionProposalRecordをstatus=pendingで生成する。
- PendingAssumptionProposal subtypeとしてsession-local stateへ保持する。
- proposalId、conversationId、turnId、revision、statusをAIに生成させない。
- proposalIdをassumptionProposalRefとして後続DA0 adapterへ渡せる。
- unit/contract/integrationでdraft、record、pending subtypeの分離を証明する。

DA0aはGenericWeeklyWorkItem、candidate generator、preview block生成、scheduler配置、preview表示、save、approvalを扱わない。

## Exact types

~~~ts
type AssumptionProposalStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "superseded"
  | "expired";

type PendingAssumptionProposalDraft = {
  slot: PlanningAssumptionSlot;
  targetRef: string;
  proposedValue: AssumptionValue;
  proposedUnit?: AssumptionUnit;
  reasonText?: string;
  sourceFactRefs: string[];
};

type AssumptionProposalRecord = {
  proposalId: string;
  conversationId: string;
  slot: PlanningAssumptionSlot;
  targetRef: string;
  proposedValue: AssumptionValue;
  proposedUnit?: AssumptionUnit;
  reasonText?: string;
  sourceFactRefs: string[];
  createdAtTurnId: string;
  createdFromStateRevision: number;
  status: AssumptionProposalStatus;
  decidedAtTurnId?: string;
  decidedAtStateRevision?: number;
  supersededByProposalId?: string;
};

type PendingAssumptionProposal =
  AssumptionProposalRecord & {
    status: "pending";
  };
~~~

AI出力はdraftだけである。coreはdraft、public source facts、conversation/turn/current revisionからdeterministic IDとcanonical recordを生成する。

## Transition / validator / failure

transitionはno draft → draft validation → canonical status=pending → session-local保持 → DA0へproposalRef handoffで終了する。accepted/rejected/superseded/expiredへの遷移はDA1bの責務である。

schema、slot/unit/value、finite/range/size、sourceFactRefs non-empty、public fact registry、targetRef、conversation/turn/revision、authorization、duplicateをvalidateする。private/unknown source、別user/conversation、source revision mismatchはcanonical化しない。reason/source/titleはuntrusted JSON dataである。

interpreter failure、planner failure、StaleAsyncResultはDA1/DA2のcategoryと混同しない。active request一件、revision monotonicity、request混入なし。session-localのみ。save、repository、UI承認、migration、dialogue planner、relative constraint、scheduler全面改修はnon-goalである。

## P1〜P7 responsibility

| Perspective | Applicability | Owning task | Required assertion |
| --- | --- | --- | --- |
| P1 | Covered by another task | DA2 | request/submit lifecycle |
| P2 | Covered by another task | DA2 | IME/focus/keyboard |
| P3 | Applicable | DA0a | hostile draft/source boundary |
| P4 | Not applicable | DA0、approval | DA0aはpreview/save非所有 |
| P5 | Not applicable or regression only | future persistence、DA2 | session-local、no migration |
| P6 | Applicable | DA0a、DA2 | failure categoryとexam/non-exam |
| P7 | Applicable | DA0a | draft/record/pending、refs/revision trace |

## Acceptance / tests / commands

unit:

- draft schema、deterministic ID、public source、stale、duplicate。
- status=pending以外をDA0aが生成しない。

contract:

- draft、AssumptionProposalRecord、PendingAssumptionProposalを別型・別証跡にする。
- lifecycle metadataをAI outputから受け取らない。
- DA0へ渡すassumptionProposalRefがcanonical proposalIdである。

integration:

- unknown duration candidate。
- proposal draft validation。
- deterministic canonicalizationとproposal ID生成。
- source fact/revision検証。
- session-local pending保持。
- DA0 adapterへproposalRefを渡せること。
- exam regression。

unknown duration → pending previewという試験はDA0aから削除する。preview生成の最初のintegration testはDA0が所有する。

property/fuzzはduplicate、long strings、NaN/Infinity、revision、cross-conversation source。roleplayはWP-DA-001 turns 3〜4、P3-ASSUMPTION-DECISION-001の前提、P7 matrix。real-modelはredacted draft fixture replayのみ。既存test/build/lintを確認して実行し、git diff --checkとstatusを確認する。Git writeは禁止。
