# DA2: state-grounded dialogue orchestrator

Status: **queued — DA1/DA1b/approval after**
Priority: High
Parent: [weekly-planning-dialogue-architecture-v4.md](../../architecture/weekly-planning-dialogue-architecture-v4.md)
Requirement IDs: DA-TURN-001, DA-ACTION-001, DA-FALLBACK-001, DA-PERSISTENCE-001, DA-SAFE-001
Traceability: [weekly-planning-roleplay-test-plan.md](../../testing/weekly-planning-roleplay-test-plan.md)
Dependencies: DA1 → DA1b → Draft approval idempotency → DA2

## Scope / path / entry / exit

accepted interpreter stateをsnapshot化し、plannerへ渡し、response validate/renderするasync orchestrationを実装する。現行pipeline、NaturalLanguageAssistant request lifecycle、renderer injection、opening guardを再調査する。

EntryはDA1、DA1b、approval contracts完了。Exitはstate machine、opening once、double submit、active request、reset、history clear、unmount、StaleAsyncResult、retry、IME、keyboard binding、multiline、focus restore、Tab orderがcontract/integration testsで固定されること。

~~~ts
type DialogueRequestPhase =
  | "idle"
  | "interpreting"
  | "applying"
  | "calculating"
  | "planning_response"
  | "validating_response"
  | "rendering"
  | "failed";

type DialogueTurnEnvelope = {
  conversationId: string;
  turnId: string;
  requestId: string;
  inputStateRevision: number;
  userText: string;
  createdAt: string;
};
~~~

transitionはidle→interpreting→applying→calculating→planning_response→validating_response→rendering→idle。interpreter failureはturn-wide rules fallback、planner failureはaccepted state保持+deterministic response、StaleAsyncResultはsilent discard。same conversationのactive requestは一件である。

## Concurrency / stale / retry

duplicate submit、button+keyboard、StrictMode opening、reset、preview close、history clear、unmount、abort、timeout後old responseをtokenで無効化する。requestId、turnId、conversationId、stateRevision mismatch、cancel、mode reset、unmountはStaleAsyncResultである。

StaleAsyncResultはstate、history、status、previewへ反映せず、stale由来fallbackも表示しない。retryは新しいrequest/turn identityでのみ開始する。

StalePreviewApprovalAttemptはapproval taskがdeterministic user-facing rejectionを表示する別categoryであり、DA2のsilent discardを適用しない。

opening最大1 call、normal最大2 call。empty candidatesはfailureでなく、retry loop、rules/AI merge、extra callは禁止する。

## Keyboard / accessibility decision

DA2はIME、keyboard binding、multiline、focus、Tab orderのownerである。

- composition中は送信しない。
- buttonとkeyboardが同じturnを二重submitしない。
- multiline入力を失わない。
- 送信完了/失敗後のfocus restoreを固定する。
- Tab orderを論理順にする。
- Enter bindingはOption A（Enter送信、Shift+Enter改行）とOption B（Enter改行、Ctrl/Meta+Enter送信）を日本語IME、accessibility、mobile、誤送信で比較し、DA2実装時に一つへ確定する。
- 決定前のroleplayは特定bindingをstrictにしない。

request/historyはsession-localでF5時auto-runしない。AI save/approve/delete、UI/CSS全面改修、scheduler、approval ledger、migration本体はnon-goalである。

## P1〜P7 responsibility

| Perspective | Applicability | Owning task | Required assertion |
| --- | --- | --- | --- |
| P1 | Applicable | DA2 | opening、submit、reset、stale、retry |
| P2 | Applicable | DA2 | IME、keyboard、multiline、focus、Tab |
| P3 | Applicable | DA2 | hostile identity/revision boundary |
| P4 | Covered by another task | approval | stale preview/save |
| P5 | Regression only | DA2、future persistence | session-local、no auto-run |
| P6 | Applicable | DA2 | fallback categories、exam regression |
| P7 | Applicable | DA2 | request/turn/conversation/revision trace |

## Acceptance / tests / commands

unitはenvelope、phase、token、call budget、retry identity。contractはsequence、fallback category、StaleAsyncResult silent discard。integrationはStrictMode、double submit、reset、history clear、unmount、delay/reorder、accepted retention、IME、keyboard、multiline、focus、Tab。property/fuzzはduplicate IDs、cancel races、response reorder。

roleplayはWP-DA全turn、P1-OPENING-001、P1-DOUBLE-SUBMIT-001、P1-RESET-STALE-001、P2-IME-001、P2-KEYBOARD-FOCUS-001、P6-STALE-ASYNC-DISCARD-001、P6-PLANNER-FAILURE-001。real-modelはlatency/error injectionとredacted replay。existing test/build/lint、diff check、docs-only status、Git write禁止。
