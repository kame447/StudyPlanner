# DA1: DialogueStateSnapshotとDialogueAction/response contract

Status: **queued — DA0 after**
Priority: High
Parent: [weekly-planning-dialogue-architecture-v4.md](../../architecture/weekly-planning-dialogue-architecture-v4.md)
Requirement IDs: DA-ACTION-001, DA-RESPONSE-001, DA-FALLBACK-001, DA-SAFE-001
Traceability: [weekly-planning-roleplay-test-plan.md](../../testing/weekly-planning-roleplay-test-plan.md)
Dependencies: DA0 → DA1

## Scope / current path / entry / exit

snapshotから有限action、allowed topic/option/fact field、responseParts、preview offerを検証可能にする。現行dialogue renderer、state summary、decision taxonomy、public fact境界を再調査する。

EntryはDA0 preview contract完了。ExitはresponsePartsだけがAI出力上の使用fact/topic/optionの正になり、coreがused refsを導出し、valid responseだけがpublic factsをrenderし、invalid responseが全体rejectされること。

## Exact response contract

~~~ts
type DialogueTextPurpose =
  | "acknowledgement"
  | "transition"
  | "empathy"
  | "instruction"
  | "closing";

type DialogueTextPart = {
  kind: "text";
  purpose: DialogueTextPurpose;
  text: string;
};

type PublicFactFormatterId =
  | "plain"
  | "date_ja"
  | "weekday_ja"
  | "time_hm"
  | "duration_minutes"
  | "duration_hours_minutes"
  | "planning_range_ja"
  | "count_ja";

type DialogueResponsePart =
  | DialogueTextPart
  | {
      kind: "fact";
      factRef: string;
      field: PublicFactField;
      formatterId?: PublicFactFormatterId;
    }
  | {
      kind: "question";
      topicId: string;
      optionIds?: string[];
    }
  | {
      kind: "option";
      optionId: string;
    };

type DialogueResponsePlan = {
  action: DialogueActionKind;
  responseParts: DialogueResponsePart[];
  assumptionProposalDraft?: PendingAssumptionProposalDraft;
  previewOffer?: {
    previewId: string;
    stateRevision: number;
  };
};

type ValidatedDialogueResponsePart = Readonly<DialogueResponsePart>;

type ValidatedDialogueResponsePlan = {
  action: DialogueActionKind;
  responseParts: ValidatedDialogueResponsePart[];
  usedFactRefs: string[];
  usedQuestionTopicIds: string[];
  usedOptionIds: string[];
  assumptionProposalDraft?: PendingAssumptionProposalDraft;
  previewOffer?: {
    previewId: string;
    stateRevision: number;
  };
};

type DialoguePlannerResultEnvelope = {
  conversationId: string;
  turnId: string;
  requestId: string;
  inputStateRevision: number;
  outputStateRevision: number;
  responsePlan: DialogueResponsePlan;
};
~~~

factRefsとquestionTopicsをDialogueResponsePlanへ持たせない。validatorはresponsePartsからusedFactRefs、usedQuestionTopicIds、usedOptionIdsを順序保持・重複除去で導出する。allow-list照合後だけValidatedDialogueResponsePlanを生成する。一件でもinvalidならresponse全体rejectし、partial responseを描画しない。

## Formatter registry / free text validator

formatter registryとfield互換表はDA1が所有する。title/subject=plain、date=date_ja、weekday=weekday_ja、start/end=time_hm、duration系=duration_minutesまたはduration_hours_minutes、planningRange=planning_range_ja、count=count_jaに限定する。不正組み合わせは全体rejectする。

DA1はMAX_DIALOGUE_TEXT_PART_CODE_POINTSを実装前に固定し、初期値を120 code pointsとする。

text part validator:

- 数字、時刻、日付、期間、件数を含む場合は原則reject。
- snapshotのtask/event/material title完全一致をreject。
- required/available/scheduled/unscheduledの数値説明をreject。
- factを示す文はfact partへ分解。
- HTML/script/実行可能markdownとして扱わずescaped plain textで描画。
- textからstate、fact、actionを再抽出しない。
- 数値を伴う定型表現はdeterministic phrase/question rendererへ移す。

制限緩和はDA3c評価に基づく別taskとし、DA1初期契約では安全側に固定する。

## State / validator / failure

accepted/rejected/pending/correction/feasibility/preview snapshotをimmutable入力にする。askedTopicHistory/activeQuestionとallowedQuestionTopicsを別管理する。action、field、formatter、factRef、topic、option、previewId、revisionをallow-list検証する。

offer_previewはpreviewId/stateRevision一致/stale=false、propose_assumptionはdraft/sourceFactRefs、fallbackはproposal/preview/private diagnostic/extra call禁止。unknown/duplicate/private/stale itemはresponse全体reject。response textを再parseしてstateを更新しない。

interpreter failure、planner failure、StaleAsyncResultを別diagnosticにする。active request lifecycleはDA2。contractはsession-local、save/migration/repositoryはnon-goal。stringsはuntrusted JSON dataである。

## P1〜P7 responsibility

| Perspective | Applicability | Owning task | Required assertion |
| --- | --- | --- | --- |
| P1 | Covered by another task | DA2 | request/submit lifecycle |
| P2 | Covered by another task | DA2 | IME/focus/keyboard |
| P3 | Applicable | DA1 | hostile response/grounding boundary |
| P4 | Covered by another task | approval | preview/save/idempotency |
| P5 | Not applicable or regression only | future persistence、DA2 | migration scope |
| P6 | Applicable | DA1、DA2 | planner fallback、stale分離 |
| P7 | Applicable | DA1 | responsePartsとderived refs trace |

## Acceptance / tests / commands

unitはfinite union、formatter registry、field互換、text validator、allow-list、no-reask。contractはaction validator、responseParts-only schema、derived used refs、envelope/revision、invalid全体reject。integrationはsnapshot→planner→validator→deterministic renderer、clarification orthogonality、planning range accepted後no re-ask。property/fuzzはunknown/private IDs、duplicate option、invalid formatter、数字/日時/title leak、oversize。

roleplayはWP-DA turns 1、3〜11、P3-STALE-REF-001、P3-RESPONSE-DUPLICATE-SOURCE-001、P3-TEXT-FACT-LEAK-001、P6-PLANNER-FAILURE-001。real-modelはresponse fixture replay。既存scripts、diff check、status、Git write禁止。
