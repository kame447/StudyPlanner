# DA2: state-grounded dialogue orchestrator

Status: **queued — DA1/DA1b/approval after**
Priority: High
Parent: ../../architecture/weekly-planning-dialogue-architecture-v4.md
Requirement IDs: DA-TURN-001, DA-ACTION-001, DA-FALLBACK-001
Dependencies: DA1 → DA1b → Draft approval idempotency

## Scope / path / entry / exit

accepted interpreter stateをsnapshot化し、plannerへ渡し、response validate/renderするasync orchestration。現行pipeline、NaturalLanguageAssistant request lifecycle、renderer injection、opening guardを再調査する。Entryはapproval contract、Exitはstate machine、stale、call budget、keyboard/focusがcontract testsで固定されること。

```ts
type DialogueRequestPhase =
  | "idle" | "interpreting" | "applying" | "calculating"
  | "planning_response" | "validating_response" | "rendering" | "failed";
type DialogueTurnEnvelope = {
  conversationId: string;
  turnId: string;
  requestId: string;
  inputStateRevision: number;
  userText: string;
  createdAt: string;
};
```

transition: idle→interpreting→applying→calculating→planning_response→validating_response→rendering→idle。interpreter failureはturn-wide rules fallback、planner failureはaccepted state保持+deterministic response、stale/cancelはdiscard。same conversationのactive requestは一件。

## Concurrency / keyboard / failure

duplicate submit、button+keyboard、StrictMode opening、reset、preview close、history clear、unmount、abort、timeout後old responseをtokenで無効化する。identity/revision mismatchはcommitしない。stale由来fallbackも表示しない。opening最大1call、normal最大2call。empty candidatesはfailureでなく、retry loop/rules merge/extra callは禁止。

IME中送信抑止、multiline、focus restore、Tab順、button/keyboard重複防止はstrict。Enter bindingはOption A（Enter送信/Shift改行）とOption B（Enter改行/Ctrl/Meta送信）を日本語IME、accessibility、mobile、誤送信で比較しDA2で決める。決定前のroleplayはbindingを固定しない。

Failure categoriesはinterpreter failure、planner failure、stale/cancelledを分離する。request/historyはsession-local、F5でauto-runしない。AI save/approve/delete、UI/CSS全面改修、scheduler、approval ledger、migration本体はnon-goal。

## P1〜P7 responsibility

| Perspective | Applicability | Owning task | Required assertion |
| --- | --- | --- | --- |
| P1 | Regression only | DA2 | submit/request lifecycle |
| P2 | Covered by another task | DA2 | IME/keyboard |
| P3 | Applicable | DA2 | hostile boundary |
| P4 | Covered by another task | approval | stale/save |
| P5 | Not applicable | future persistence | no migration |
| P6 | Applicable | DA2 | fallback/exam |
| P7 | Applicable | DA2 | ref/revision trace |



## Acceptance / tests / commands

unit: envelope/phase/token/call budget。contract: sequence/fallback/stale。integration: StrictMode/reset/unmount/delay/accepted retention/keyboard。property/fuzz: reorder、duplicate IDs、cancel races。roleplay: WP-DA全turn、P1/P2/P3/P6。real-modelはlatency/error injectionとredacted replay。existing test/build/lint、diff check、docs-only status、Git write禁止。
