# weeklyPlanning 対話アーキテクチャ v4（state-grounded AI dialogue）

Status: **設計の正（v4 DoR）**
最終更新: 2026-07-13

## 優先順位・範囲

プロダクト目的の正は docs/weekly-planning/weekly-planning-spec.md、次に本文書、七視点監査、安全境界、実装状況、旧 docs の順である。現在コードは実装確認にのみ使い、仕様の正とはしない。今回の変更は docs のみで src/features/weeklyPlanning の既存差分を変更しない。

対象は opening、週間対話、exam/non-exam intake、preview、承認前 draft。保存済み予定の自動変更、AI の approve/save/delete、複雑な recurrence、sharing、scheduler 全面書換えは対象外。

## ゴール・安全境界

自然な入力を single AI interpreter で typed candidates にし、deterministic core が normalize → validate → adapter → reducer → scheduler/availability/feasibility/preview を実行する。更新後 snapshot と allow-list を AI dialogue planner に渡し、DialogueResponsePlan を検証して fact を deterministic に描画する。

- DA-GOAL-001: 受理済み情報・計算結果・次の一問を短く示し、固定順尋問に戻さない。
- DA-GOAL-002: preview は未承認 draft。save/approve/delete は明示 UI 操作のみ。
- DA-SAFE-001: AI は state/scheduler/repository を直接変更しない。
- DA-SAFE-002: 通常 turn は interpreter + planner の最大2 call、opening は最大1 call。空 candidates は正常値。
- interpreter と rules parser は merge しない。provider exception/timeout/parse/schema/semantic/stale だけ turn-wide fallback、追加 AI call なし。
- date/time/capacity/placement、fact ID、revision、accepted/rejected/assumption、approval/save は deterministic core の正。

~~~text
userText → AI interpreter → typed candidates → normalize/validate
→ adapter/reducer → scheduler/availability/feasibility/preview recalc
→ DialogueStateSnapshot + AllowedDialogueActions
→ AI dialogue planner → DialogueResponsePlan validation
→ deterministic fact rendering → UI
~~~

## non-exam preview bridge（DA0）

StudyTaskScope を duration/quantity（明示、未知、範囲）へ下ろし、未知値は PendingAssumptionProposal、明示 duration は typed candidate とする。GenericWeeklyWorkItem に変換して既存 candidate generator/preview へ渡す。複数 task、priority、期限、existing events、unscheduled/capability/missing-context を分類し、exam path と共存させる。scheduler 再実装、candidate merge、unitKind 無制限一般化、保存/承認は DA0 外。

## 型・ライフサイクル

~~~ts
type AssumptionProposalStatus = "pending"|"accepted"|"rejected"|"superseded"|"expired";
type PendingAssumptionProposal = {
  proposalId:string; slot:string; targetRef:string; proposedValue:string|number;
  unit?:"minutes"|"count"|"pages"|"items"|"unknown"; reason:string;
  source:"ai"|"deterministic"; sourceFactRefs:string[];
  createdAtTurnId:string; createdFromStateRevision:number; status:AssumptionProposalStatus;
};
type CorrectionOperation = "replace"|"remove"|"supersede"|"restore";
type CorrectionTarget = {factId?:string; proposalId?:string; commandId?:string; taskRef?:string; eventRef?:string; slot?:string};
type CorrectionEnvelope = {
  correctionId:string; operation:CorrectionOperation; target:CorrectionTarget;
  replacementCommand?:unknown; sourceText:string; confidence:number; expectedStateRevision:number;
};
~~~

accept_assumption/reject_assumption/modify_assumption は proposalId、expectedStateRevision、value/unit、confidence、sourceText を持つ。pending は hard apply しない。reject を再活性化せず、modify は旧を superseded、新 proposal を作る。revision/sourceFactRefs mismatch は stale。target 非一意は clarification。replace は old fact を superseded として監査履歴に残し、remove/restore を区別する。訂正は atomic に検証し、accepted/rejected/assumption と preview stale を再計算する。

~~~ts
type DialogueStateSnapshot = {
  conversationId:string; stateRevision:number;
  acceptedFacts:Array<{factId:string;field:string;value:unknown}>;
  rejectedCommands:Array<{commandId:string;reason:string}>;
  pendingAssumptionProposals:PendingAssumptionProposal[]; correctionHistory:CorrectionEnvelope[];
  planningRange?:{start:string;end:string;sourceFactRefs:string[]};
  existingEvents:Array<{eventId:string;title:string;start:string;end:string}>;
  feasibility:{requiredMinutes:number;scheduledMinutes:number;unscheduledRefs:string[];conflicts:string[]};
  preview?:{previewId:string;stateRevision:number;draftBlockIds:string[];stale:boolean};
  allowedQuestionTopics:string[]; recentHistory:Array<{role:"user"|"assistant";text:string}>;
};
type DialogueResponsePart =
 | {kind:"text";text:string}|{kind:"fact";factRef:string;field:string}
 | {kind:"question";topic:string;optionIds?:string[]}
 | {kind:"option";optionId:string;labelFactRef?:string};
type DialogueResponsePlan = {
 action:string; factRefs:string[]; questionTopics:string[]; responseParts:DialogueResponsePart[];
 assumptionProposal?:PendingAssumptionProposal; previewOffer?:{previewId:string;stateRevision:number};
};
~~~

text は接続語だけ。日時、分数、件数、タイトル、範囲は fact part。factRef/field は public allow-list と revision に一致しなければ response 全体を reject。unknown/private/stale ref、未許可 option/topic、根拠なし preview は fallback。response を再パースして state を更新しない。

## turn・stale・request

~~~ts
type DialogueTurnEnvelope = {
 conversationId:string; turnId:string; requestId:string; inputStateRevision:number;
 userText:string; createdAt:string;
};
type DialogueRequestState = {
 activeRequestId?:string; activeTurnId?:string;
 phase:"idle"|"interpreting"|"applying"|"calculating"|"planning_response"|"validating_response"|"rendering"|"failed";
 startedAt?:string;
};
~~~

一 conversation 一 active request。duplicate text/turn/request、abort、mode reset、preview close、unmount、history clear は request を無効化する。conversation/turn/request/input-output revision mismatch は state/history/status/preview に反映しない。interpreter 成功 + planner 失敗は accepted state を保持して deterministic response。StrictMode opening は一度、render で provider call なし。

## preview、approval、persistence

previewId と stateRevision に束縛し、proposal rejection、correction、reset、再計算で stale、stale は保存不可。

~~~ts
type WeeklyDraftApprovalOperation = {
 approvalOperationId:string; userId:string; sourceDraftBlockIds:string[]; startedAt:string;
 status:"pending"|"partially_saved"|"completed"|"failed";
};
type ApprovedPlanSource = {
 sourceType:"weekly_draft"; sourceDraftBlockId:string; approvalOperationId:string;
};
~~~

userId + sourceDraftBlockId + approvalOperationId を重複キーにし、ledger、source metadata、partial failure、crash/retry、optimistic rollback を扱う。AI は operation を起動しない。会話/request/pending proposal は session-local、既存 draft block localStorage は維持する。reload 後に response/request を自動実行・保存・復元しない。将来 schema は schemaVersion/userId/weekStartDate/draftBlocks/messages?/pendingAssumptionProposals?/stateRevision、未知/破損/他 user/week/上限超過は安全に破棄し versioned/idempotent migration。

## fallback

unavailable、exception、timeout、parse/schema、unknown action/ref/field、unauthorized/stale、invalid proposal/correction/response、unsupported capability、size/option/topic/preview violation を対象とする。accepted/rejected/pending を保持し、deterministic fact、次の許可 topic、retry indication のみ返す。stale offer、内部エラー名、private ID を出さない。空 candidates は provider failure でなく、rules/AI merge、追加 AI call、無限 retry をしない。

## queue（同時に一件だけ open）

P4 は verification gate（open implementation、closed、adopted、migration complete ではない）。

| 順 | item | status |
| --- | --- | --- |
| 0 | Gate P4（既存差分検証） | verification gate |
| 1 | DA0 non-exam preview bridge | **open** |
| 2 | DA1 dialogue action contract | queued |
| 3 | DA1b correction contract | queued |
| 4 | Draft approval idempotency | queued |
| 5 | DA2 state-grounded orchestrator | queued |
| 6 | DA3a relative constraint domain | queued |
| 7 | DA3b feasibility consultation | queued |
| 8 | DA3c conversation evaluation | queued |

DA0 完了後に次の一件だけ open。旧 D1/D2/D3、P5〜P9、T6 は historical/superseded。

## 評価・未解決

strict assertion は action/factRef/field/state/stateRevision/requestId/turnId/proposal/correction/topic/option/preview/stale/fallback/call count/duplicate/accepted/rejected/diagnostics。rubric は敬体、簡潔、no re-ask、無関係な一括質問なし、内部 slot 非表示、仮定/事実の区別、根拠なし値なし、次入力明確、mentor options、入力無視なし。golden text 完全一致は要求しない。

traceability ID は DA-GOAL-001、DA-SAFE-001、DA-INTERPRET-001、DA-ACTION-001、DA-TURN-001、DA-ASSUMPTION-001、DA-CORRECTION-001、DA-RESPONSE-001、DA-PREVIEW-001、DA-RELATIVE-001、DA-FEASIBILITY-001、DA-PERSISTENCE-001、DA-IDEMPOTENCY-001、DA-FALLBACK-001、DA-EVAL-001。text 数値、limits、proposal expiry、target resolution、one-question grouping、revision increment は DA1/DA1b、opening/timeout/cancel/input/mode/F5/Enter/focus は DA2、model/token/latency/fallback/rejection/completion metrics は DA3c が決める。
