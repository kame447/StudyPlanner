# weeklyPlanning 対話アーキテクチャ v4（state-grounded AI dialogue）

Status: **設計の正（v4 DoR）**
最終更新: 2026-07-14

Product goal: [weekly-planning-spec.md](../weekly-planning/weekly-planning-spec.md)
Historical evidence: [weekly-planning-dialogue-architecture.md](weekly-planning-dialogue-architecture.md)、[weekly-planning-nl-capability-model.md](weekly-planning-nl-capability-model.md)
Canonical test and requirement traceability: [weekly-planning-roleplay-test-plan.md](../testing/weekly-planning-roleplay-test-plan.md)

## 1. 範囲と不変条件

対象はopening、週間対話、exam/non-exam intake、pending assumption、correction、preview、承認前draftである。保存済み予定のAI自動変更、AI approve/save/delete、complex recurrence、sharing、scheduler全面書換えは対象外とする。

- provider時の自然文意味解釈はsingle AI interpreterとし、AI結果とrules parser結果をmergeしない。
- typed candidate以降のnormalize、validate、adapter、reducer、scheduler、preview、approval/saveはdeterministic coreが担う。
- AIはstate、scheduler、repository、save、approve、deleteを直接変更しない。
- previewは未承認draftであり、explicit UI approvalまでsaveしない。
- 通常turnはinterpreter + plannerの最大2 call、openingは最大1 call。empty candidatesは正常結果である。
- user-originated stringはuntrusted JSON dataであり、action、factRef、option ID、formatter ID、prompt命令へ昇格させない。
- accepted stateから導出したplanning hypothesisはacceptedFacts、constraints、repositoryへ直接書き込まない。
- readinessとDraftGenerationIntentはdeterministic coreだけが判定し、AIはpreview可否を自己申告しない。
- Gate P4完了前にopen implementation taskはない。current queueは本書 §11 とroadmap冒頭だけを正とする。

~~~text
userText + structured context
  → single AI interpreter → typed candidates
  → normalize / validate / adapter / reducer
  → accepted facts / pending proposals
  → deterministic behavior derivation
      LifeActivityAnchor / TaskExecutionProfile / PlanningOpportunityAnnotation
  → PlanningHypothesisSnapshot
      readiness / resolution opportunities / suggested next action
  → DialogueStateSnapshot + AllowedDialogueActions
  → AI dialogue planner → response validator
  → deterministic fact / question / option rendering → UI
  → readiness=preview_ready かつ DraftGenerationIntent=user_authorized の場合のみ
      scheduler / availability / feasibility / preview
  → explicit assumption decision / correction → latest eligible preview
  → explicit UI approval → save
~~~

## 2. assumption proposal draft、record、pending subtype

AI出力、canonical lifecycle record、pending限定viewを分離する。

~~~ts
type Confidence = "high" | "medium" | "low";
type AssumptionValue = string | number | boolean;

type PlanningAssumptionSlot =
  | "duration"
  | "quantity"
  | "planning_period"
  | "priority"
  | "completion_target";

type AssumptionUnit =
  | "minutes"
  | "hours"
  | "pages"
  | "problems"
  | "words"
  | "lessons"
  | "chapters"
  | "count"
  | "unknown";

type AssumptionProposalStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "superseded"
  | "expired";

type AssumptionProposalReasonCode =
  | "missing_duration"
  | "missing_quantity"
  | "missing_planning_period"
  | "missing_priority"
  | "missing_completion_target"
  | "domain_default"
  | "history_based_estimate"
  | "first_trial_estimate";

type ProposalResolutionRef =
  | {
      kind: "proposal";
      proposalId: string;
    }
  | {
      kind: "fact";
      factId: string;
    }
  | {
      kind: "correction";
      correctionId: string;
    };

type PendingAssumptionProposalDraft = {
  slot: PlanningAssumptionSlot;
  targetRef: string;
  proposedValue: AssumptionValue;
  proposedUnit?: AssumptionUnit;
  reasonCode: AssumptionProposalReasonCode;
  sourceFactRefs: string[];
};

type AssumptionProposalRecord = {
  proposalId: string;
  conversationId: string;
  slot: PlanningAssumptionSlot;
  targetRef: string;
  proposedValue: AssumptionValue;
  proposedUnit?: AssumptionUnit;
  reasonCode: AssumptionProposalReasonCode;
  sourceFactRefs: string[];
  createdAtTurnId: string;
  createdFromStateRevision: number;
  status: AssumptionProposalStatus;
  decidedAtTurnId?: string;
  decidedAtStateRevision?: number;
  resolvedBy?: ProposalResolutionRef;
};

type PendingAssumptionProposal =
  AssumptionProposalRecord & {
    status: "pending";
  };
~~~

AIが返せるのはPendingAssumptionProposalDraftだけである。reasonCodeは有限unionで、reasonTextその他の任意理由文はschema rejectする。proposalId、conversationId、turnId、revision、status、resolvedByはdeterministic coreが発行し、private/unknown/stale sourceや別user/conversationのsourceはcanonical化しない。reasonCodeとslotの互換性を検証し、history_based_estimateはpublic sourceFactRefs必須、domain_defaultはcoreが検証したdeterministic policy IDまたはpublic source ref必須、first_trial_estimateは表示時に仮定であることを明示する。

DA0aの責務はdraft validation、canonical status=pending record生成、session-local state保持、後続DA0へproposalRefを渡せる状態までである。DA0aはwork item、candidate generation、preview block、scheduler、表示、save、approvalを扱わない。

lifecycle transitionはDA1bが所有する。

~~~text
pending → accepted | rejected | superseded | expired
~~~

status変更時も元recordを履歴から失わない。acceptedはaccept_assumptionでproposal値をaccepted factへ移した状態、rejectedは明示拒否、supersededは同じtarget/slotの明示値または新proposalによる直接置換、expiredはsource fact、target、planning range、task scopeが直接replacementなしに無効化された状態である。modifyは旧recordをsupersededにし、resolvedBy={kind:"proposal", proposalId}で新しいpending recordへ結ぶ。rejected/expired/superseded recordを暗黙にpendingへ戻さず、non-pending recordへのdecisionをrejectする。

## 3. behavior-aware planning foundation

### 3.1 事実、導出、仮説、仮定の分離

~~~ts
type PlanningFactOrigin =
  | "user_explicit"
  | "deterministic_derived"
  | "accepted_assumption"
  | "profile_memory";

type PlanningFactScope =
  | "current_turn"
  | "current_plan"
  | "current_week"
  | "recurring_profile";

type PlanningConfidence =
  | "high"
  | "medium"
  | "low";
~~~

temporary hypothesisはaccepted factではない。user explicit fact、deterministically derived fact、internal planning hypothesis、pending assumption proposal、accepted assumption fact、recurring profile memoryを別の証跡として扱う。internal planning hypothesisはacceptedFacts、constraints、repositoryへ直接書き込まない。未承認の仮説・アンカー・profile proposal・readiness関連状態は初期実装ではsession-localとする。

### 3.2 LifeActivityAnchor

~~~ts
type LifeActivityKind =
  | "school"
  | "work"
  | "commute"
  | "meal"
  | "bath"
  | "sleep"
  | "rest"
  | "preparation"
  | "fixed_event";

type LifeActivityAnchor = {
  anchorId: string;
  kind: LifeActivityKind;
  date?: string;
  startTime?: string;
  endTime?: string;
  sourceFactRefs: string[];
  origin: PlanningFactOrigin;
  scope: PlanningFactScope;
  confidence: PlanningConfidence;
};
~~~

LifeActivityAnchorはbusy intervalの代替ではない。hard/soft constraint、buffer、existing plan、timetableから作られる既存availabilityを維持し、既存availability rangeへ行動上の意味を付与する参照である。移動・準備時間でavailability自体を変える場合は既存constraintまたはbuffer処理を通す。

### 3.3 PlanningOpportunityAnnotation

第三のavailability概念を新設しない。既存available rangeへのannotationとして行動上の意味とタスク適合度を持つ。

~~~ts
type PlanningOpportunityTag =
  | "before_meal"
  | "after_meal"
  | "after_school"
  | "after_work"
  | "after_commute"
  | "before_sleep"
  | "after_rest"
  | "long_contiguous_window"
  | "short_transition_window"
  | "low_activation"
  | "high_continuity";

type StudyActivityKind =
  | "memorization"
  | "drill"
  | "reading"
  | "writing"
  | "problem_solving"
  | "project"
  | "review"
  | "unknown";

type OpportunitySuitability = 0 | 1 | 2 | 3;

type PlanningOpportunityAnnotation = {
  availabilityRangeRef: string;
  anchorRefs: string[];
  tags: PlanningOpportunityTag[];
  suitabilityByActivity: Partial<
    Record<StudyActivityKind, OpportunitySuitability>
  >;
  sourceFactRefs: string[];
};
~~~

annotationは利用可能時間を新しく作らず、hard busy intervalを短縮・拡張・上書きしない。候補枠の順位付け、対話上の説明、配置理由にだけ利用する。

### 3.4 TaskExecutionProfile

StudyTaskScopeとは別の計画用profileとして学習タスクの実行特性を表現する。

~~~ts
type TaskDistributionPolicy =
  | "single_block"
  | "contiguous"
  | "splittable"
  | "spaced"
  | "sequential_units";

type CognitiveLoad =
  | "light"
  | "medium"
  | "heavy"
  | "unknown";

type TaskExecutionProfile = {
  taskRef: string;
  activityKind: StudyActivityKind;
  distributionPolicy: TaskDistributionPolicy;
  cognitiveLoad: CognitiveLoad;
  minSessionMinutes?: number;
  targetSessionMinutes?: number;
  maxSessionMinutes?: number;
  repetitionsPerDay?: number;
  minimumSpacingMinutes?: number;
  hardDeadline?: string;
  preferredCompletionBy?: string;
  sourceFactRefs: string[];
  confidence: PlanningConfidence;
  origin:
    | "user_explicit"
    | "deterministic_derived"
    | "pending_proposal"
    | "accepted_assumption";
};
~~~

hardDeadlineとpreferredCompletionByを混同しない。テスト開始前などの境界はhard deadlineになり得るが、安全余裕はユーザーが明示していなければpending proposalである。memorizationやworkbookに固定値を埋め込まず、有限policy registry、public source fact、または過去実績から候補を作る。

StudyTaskScopeは何をどの単位で進めるか、TaskExecutionProfileはそのtaskをどの長さ・分割方針・認知負荷で実行しやすいかを表す。後者は前者を置き換えない。

### 3.5 DraftGenerationIntent

~~~ts
type DraftGenerationIntent =
  | "not_requested"
  | "assistant_suggested"
  | "user_authorized";
~~~

漠然としたgoalはnot_requested、アプリが仮予定作成を提案した段階はassistant_suggested、ユーザーが同意した段階はuser_authorizedである。assistant_suggestedだけでpreviewを生成しない。interpreter candidate、validator、deterministic transitionを通してのみ更新し、AI dialogue plannerは直接更新しない。

### 3.6 PlanningDimensionとreadiness

~~~ts
type PlanningDimension =
  | "planning_intent"
  | "planning_range"
  | "task_identity"
  | "goal_scope"
  | "workload"
  | "deadline"
  | "task_execution_profile"
  | "availability_basis"
  | "routine_anchors";

type PlanningReadinessStage =
  | "exploration"
  | "hypothesis_ready"
  | "proposal_ready"
  | "preview_ready";

type PlanningReadinessPolicy = {
  hardRequiredDimensions: PlanningDimension[];
  countedDimensions: PlanningDimension[];
  minimumResolvedCount: number;
  previewRequiredDimensions: PlanningDimension[];
};

type PlanningReadinessSnapshot = {
  stage: PlanningReadinessStage;
  resolvedDimensions: PlanningDimension[];
  unresolvedDimensions: PlanningDimension[];
  blockingDimensions: PlanningDimension[];
  resolvedCount: number;
  policyId: string;
  draftGenerationIntent: DraftGenerationIntent;
  allowedAssumptionSlots: PlanningAssumptionSlot[];
  stateRevision: number;
};
~~~

readiness policyは有限registryで管理し、exam/non-examで別policyを持ってよい。magic numberを複数箇所へ直書きせず、resolvedCountだけでpreview_readyにしない。routine anchorがなくても、ユーザーが明示的な利用可能時間を指定した場合はavailability basisとしてよい。

preview_readyは、hard required dimensionがすべてresolved、各work itemに配置可能なexecution shapeがあり、availability basisがあり、高影響のblocking uncertaintyがなく、DraftGenerationIntent=user_authorizedで、現在state revisionと一致する場合だけ許可する。

### 3.7 MissingResolutionMode

~~~ts
type MissingResolutionMode =
  | "derive_deterministically"
  | "propose_default"
  | "offer_options"
  | "must_confirm";

type ResolutionImpact =
  | "low"
  | "medium"
  | "high";

type MissingResolutionOpportunity = {
  topicId: string;
  dimension: PlanningDimension;
  mode: MissingResolutionMode;
  impact: ResolutionImpact;
  uncertainty: PlanningConfidence;
  proposalSlot?: PlanningAssumptionSlot;
  allowedOptionIds: string[];
  sourceFactRefs: string[];
};
~~~

| 不足内容 | 基本mode |
| --- | --- |
| 相対日付の一意解決 | derive_deterministically |
| 1回の目安時間 | propose_default |
| 進める量の現実的な候補 | propose_defaultまたはoffer_options |
| 朝・夕方・夜の候補 | offer_options |
| 何の試験か | must_confirm |
| 何を学習するのか | must_confirmまたはoffer_options |
| ユーザーの目的そのもの | must_confirm |
| hard deadline | must_confirmまたは明示factからderive |
| preferred completion buffer | propose_default |

安全な提案候補がある場合は質問よりproposalまたはoptionを優先する。目的そのもの、候補間で予定結果が大きく変わる事項、締切・利用可能時間へ大きな影響がある事項、根拠のない事項、既存factやprofileと矛盾する事項だけはmust_confirmとする。一turnのproposalまたはquestionは原則1〜2件、多くても3件とし、「分からない」には同じ質問を繰り返さず、propose_default、offer_options、first trialのいずれかへ移る。

### 3.8 PlanningHypothesisSnapshotと処理順

~~~ts
type PlanningHypothesisSnapshot = {
  conversationId: string;
  stateRevision: number;
  taskProfiles: TaskExecutionProfile[];
  lifeActivityAnchors: LifeActivityAnchor[];
  opportunityAnnotations: PlanningOpportunityAnnotation[];
  resolutionOpportunities: MissingResolutionOpportunity[];
  readiness: PlanningReadinessSnapshot;
  suggestedNextAction:
    | "acknowledge"
    | "propose_resolution"
    | "offer_options"
    | "ask_required_fact"
    | "suggest_draft_generation"
    | "generate_preview";
};
~~~

PlanningHypothesisSnapshotは予定blockを持たず、preview、draft candidate、saved planとして扱わない。repositoryまたはlocalStorageへ永続化せず、同じcanonical state、policy registry、revisionから同じsnapshotを生成する。AIはreadiness、suitability score、deadline、availability、suggestedNextActionを計算せず、deterministic coreがsnapshotとAllowedDialogueActionsを生成し、AI dialogue plannerは許可されたactionから選ぶ。

~~~text
userText + structured context
  → single AI interpreter
  → typed candidates
  → normalize / validate / adapter / reducer
  → accepted facts / pending proposals
  → deterministic behavior derivation
      LifeActivityAnchor / TaskExecutionProfile / PlanningOpportunityAnnotation
  → PlanningHypothesisSnapshot
      readiness / missing resolution opportunities / suggested next action
  → AllowedDialogueActions
  → AI dialogue planner
  → response validator
  → deterministic renderer
  → DraftGenerationIntent=user_authorized かつ readiness=preview_ready の場合のみ
  → scheduler / feasibility / preview
  → explicit assumption decision / correction
  → latest eligible preview
  → explicit UI approval
  → save
~~~

hypothesis_ready、proposal_ready、pending proposalの存在だけではpreviewを生成しない。preview生成を提案することと、previewを実際に生成することを分ける。

### 3.9 strict preview gate

~~~ts
const previewAllowed =
  readiness.stage === "preview_ready"
  && readiness.draftGenerationIntent === "user_authorized"
  && readiness.blockingDimensions.length === 0
  && readiness.stateRevision === currentStateRevision;
~~~

上記と意味的に同じ条件をdeterministic coreで保証する。漠然としたgoal、pending proposal一件、optional fieldの件数、assistant_suggested、高影響の未確認事項、AIの自己申告だけでpreviewを生成しない。生活アンカーannotationがhard busy intervalを上書きすること、planning hypothesisをaccepted factとして保存することも禁止する。

### 3.10 profile memoryとsession-local状態

今回のamendmentでは永続profileの保存方式を確定しない。初期実装ではPlanningHypothesisSnapshot、未承認LifeActivityAnchor、pending TaskExecutionProfile proposal、MissingResolutionOpportunity、DraftGenerationIntent、pending assumption proposalをsession-localとする。「朝は続かない」「夕食はだいたい19時」などを一度の発話だけで無期限profileへ保存しない。recurring profileへ昇格する場合は、明示同意、source、confidence、lastConfirmedAt、scope、保持期間、削除方法、矛盾時の優先規則を別taskで設計する。

### 3.11 未決定事項

| topic | options | impact | recommendation |
| --- | --- | --- | --- |
| recurring profileの保存 | session-localのみ / 明示同意後にprofile昇格 / 一度の発話で自動保存 | 永続化すると再質問は減るが、誤記憶・削除・矛盾解決・プライバシー責務が増える | MVPはsession-local。明示同意、source、confidence、lastConfirmedAt、scope、保持期間、削除、矛盾時の優先規則を別taskで決めてから昇格する |
| readiness policyの具体値 | exam/non-exam共通 / policy registryで別管理 / 各taskに直書き | 共通値は単純だが、締切と実行特性の差を吸収しにくい。直書きは変更時に不整合が出る | 有限policy registryで管理し、DA0rでは型・判定境界を実装する。具体値はdomain fixtureと後続評価で決める |
| schedulerとの統合 | annotation adapter / LifeConstraint migration / 第三のavailability追加 | migrationは既存回帰と実装範囲が大きく、第三概念はavailable minutesの二重計上を招く | annotation adapterを推奨し、既存availability・LifeConstraint・busy intervalを維持する。LifeConstraint migrationは別taskに分離する |
| TaskExecutionProfileの初期値 | 固定domain default / public policy source / first trialで再見積もり | 固定値は誤適用、外部sourceは鮮度確認、first trialは初回計画の不確実性が増える | 固定値を埋め込まず、検証済みpolicy/sourceまたはpending proposalとして扱い、必要ならfirst trialを使う |

## 4. DA0 bridge、snapshot、feasibility

DA0で初めてpending proposalをwork itemとpreviewへ接続する。

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
- proposalRefは同じuser/conversationのstatus=pending recordを指す。
- proposal targetRefとwork item taskRefが一致し、source revisionが現在も有効である。
- accepted/rejected/superseded/expired proposalをpending assumptionとして使用しない。
- eligibility=eligibleではassumptionProposalRefを要求しない。
- eligibility=rejectedのitemをpreview candidateへ渡さない。
- invalid item一件で他の明確なitemを失わない。
- pending assumptionを使用したproposalをassumptionDependenciesへ全件記録する。
- status=pendingのdependencyが一件でもあればapprovalEligibility=blocked_pending_assumptionとする。
- rejected/expired/superseded、unknown、private、revision不一致のdependencyを含むpreviewは保存可能にしない。

pending assumptionを使うpreviewは対話材料として表示し、その事実をユーザーへ明示するが、accepted factとして扱わずhard applyしない。blocked_pending_assumptionではapproval/save operationを開始せず、preview承認をaccept_assumptionへ暗黙変換しない。accept/modifyはstateRevisionを進めて旧previewをstaleにし、accepted factを使って再計算した最新previewだけをeligibleにできる。DA0はmetadataで保存不可を示すところまでを所有し、keyboard、approval operation、migration、scheduler全面改修を扱わない。

~~~ts
type AskedTopicRecord = {
  topicId: string;
  askedAtTurnId: string;
  askedAtStateRevision: number;
  status: "asked" | "answered" | "superseded" | "expired";
};

type ActiveQuestion = {
  questionId: string;
  topicId: string;
  askedAtTurnId: string;
  askedAtStateRevision: number;
  allowedAnswerKinds: string[];
};

type FeasibilityClassification =
  | "feasible"
  | "partially_feasible"
  | "infeasible"
  | "unknown";

type FeasibilitySummary = {
  classification: FeasibilityClassification;
  requiredMinutes: number;
  availableMinutes: number;
  scheduledMinutes: number;
  unscheduledMinutes: number;
  unscheduledTaskRefs: string[];
  bottleneckFactRefs: string[];
  conflictFactRefs: string[];
  deterministicOptionIds: string[];
  previewEligibility: WeeklyPreviewApprovalEligibility;
};
~~~

DialogueStateSnapshotはconversationId、stateRevision、acceptedFacts、rejectedCommands、AssumptionProposalRecord履歴、pendingAssumptionProposals、correctionHistory、planningRange、existingEvents、feasibility、preview、WeeklyPreviewMetadata、allowedQuestionTopics、askedTopicHistory、activeQuestion、lastResolvedQuestionId、recentHistoryを持つ。

allowedQuestionTopicsは今聞いてよいtopic、askedTopicHistoryは質問履歴、activeQuestionは回答待ち質問である。answered済みtopicを理由なく再質問せず、revision変更だけでは再質問しない。activeQuestionへの短答をinterpreter groundingに使う。

## 5. action、response grounding、formatter

### 4.1 AI responseの唯一の情報源

AI出力で使用fact、question topic、optionを表す正はresponsePartsだけである。factRefsやquestionTopicsを別フィールドで二重申告させない。

~~~ts
type DialogueActionKind =
  | "acknowledge"
  | "summarize_and_ask"
  | "confirm_reference"
  | "propose_assumption"
  | "explain_feasibility"
  | "offer_preview"
  | "suggest_draft_generation"
  | "answer_clarification"
  | "explain_capability_gap"
  | "fallback";

type PublicFactField =
  | "title"
  | "subject"
  | "date"
  | "weekday"
  | "startTime"
  | "endTime"
  | "durationMinutes"
  | "requiredMinutes"
  | "availableMinutes"
  | "scheduledMinutes"
  | "unscheduledMinutes"
  | "planningRange"
  | "previewBlockCount";

type PublicFactFormatterId =
  | "plain"
  | "date_ja"
  | "weekday_ja"
  | "time_hm"
  | "duration_minutes"
  | "duration_hours_minutes"
  | "planning_range_ja"
  | "count_ja";

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

type AllowedDialogueAction = {
  action: DialogueActionKind;
  allowedQuestionTopicIds: string[];
  allowedOptionIds: string[];
  allowedFactFields: PublicFactField[];
  previewOfferAllowed: boolean;
  assumptionProposalAllowed: boolean;
};

type AllowedDialogueActions = {
  stateRevision: number;
  actions: AllowedDialogueAction[];
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

validatorはresponsePartsを順に検証してusedFactRefs、usedQuestionTopicIds、usedOptionIdsを導出し、順序を保って重複除去する。question part内のoptionIdsと独立option partの両方をusedOptionIdsへ含める。allow-list照合が全件成功した場合だけValidatedDialogueResponsePlanを生成する。一件でもinvalidならresponse全体をrejectし、partial responseを描画しない。

### 4.2 formatter registry

formatter registryとfield互換表のownerはDA1である。任意string formatterを認めない。

| field | allowed formatter |
| --- | --- |
| title、subject | plain |
| date | date_ja |
| weekday | weekday_ja |
| startTime、endTime | time_hm |
| durationMinutes、requiredMinutes、availableMinutes、scheduledMinutes、unscheduledMinutes | duration_minutes、duration_hours_minutes |
| planningRange | planning_range_ja |
| previewBlockCount | count_ja |

formatter省略時もregistryがfieldごとのdefaultを決める。date + date_ja、startTime + time_hmはvalid。title + duration_minutes、requiredMinutes + planning_range_jaはresponse全体rejectである。

### 4.3 free text validator

text partは事実値の運搬路にしない。DA1はMAX_DIALOGUE_TEXT_PART_CODE_POINTSを実装前に固定し、初期安全契約では120 code points以下とする。変更はDA3c評価を根拠に別taskで行う。

- ASCII/全角数字、数量として使われる漢数字を含むtextは原則rejectする。
- 時刻形式、日付形式、期間、件数、required/available/scheduled/unscheduledの数値説明をrejectする。
- snapshotに存在するtask title、event title、material名の完全一致をrejectする。
- 事実を示す文はfact partへ分解する。
- HTML、script、実行可能なmarkdown commandとして扱わず、escaped plain textで描画する。
- textからstate、fact、actionを再抽出しない。
- 「一つ確認します」のような数表現が必要ならdeterministic phraseまたはquestion partから描画する。AI free textでは許可しない。

通常経路の数値・日時・タイトル・期間はfact partだけからdeterministicに描画する。制限緩和はDA3cの会話品質評価後に別taskで判断する。

### 4.4 proposal reason renderer

proposal理由はAI free textでなく、deterministic rendererがreasonCode、slot、proposed value、public sourceFactRefs、targetRefに対応するpublic fact、formatter registryからDialogueResponsePart[]へ変換する。reasonCode自体をユーザーへ表示せず、数値、日時、タイトルはfact partと互換formatterで描画する。rendererはstateを更新せず、DialogueTextPartのfree text validatorを迂回する任意文字列入力を持たない。

duration + missing_duration、quantity + missing_quantity、planning_period + missing_planning_periodは互換であり、duration + missing_priority、priority + missing_durationはreject例である。unknown reasonCode、reasonText field、slot非互換、private/stale source、history_based_estimateのsourceFactRefs欠落、検証済みpolicy/sourceのないdomain_defaultはproposal全体をrejectする。first_trial_estimateはdeterministic phraseで未確定の仮定と明示する。

### 4.5 action validator

| action | 必須 | 禁止 |
| --- | --- | --- |
| acknowledge | allowed responseParts | save/approve |
| summarize_and_ask | allowed question part | answered topicの理由なし再質問 |
| confirm_reference | public fact part | 空sourceの利用中断定 |
| propose_assumption | draft/reasonCode/sourceFactRefs | reasonText、canonical ID/status、hard apply |
| explain_feasibility | deterministic facts/options | AI再計算、任意option |
| suggest_draft_generation | readinessに基づくdeterministic fact/option | preview生成、save/approve |
| offer_preview | previewId、revision一致、stale=false、WeeklyPreviewMetadata一致、preview gate | save/approve、blocked状態のeligible偽装 |
| answer_clarification | target topic/fact | accepted commandの破棄 |
| explain_capability_gap | capability fact | unsupported preview |
| fallback | deterministic partsのみ | proposal、preview、private diagnostic、extra call |

## 6. assumption decisionとcorrection

### 5.1 AssumptionDecisionCommand

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
~~~

accept/rejectにreplacementValueを付けず、modifyではreplacementValue必須とする。accept_assumptionはaccepted factを生成してrecordをacceptedにし、reject_assumptionはrecordをrejectedにする。modify_assumptionは旧recordをsuperseded、新recordをpendingにしてresolvedByのproposal参照で結ぶ。いずれもdecidedAtTurnId/decidedAtStateRevisionを記録しstateRevisionを進める。unknown ID、non-pendingへの重複decision、revision mismatch、別user/conversation/targetはそのdecisionだけrejectする。一件の失敗で同turnの別の明確なcommandを破棄しない。

### 5.2 CorrectionTargetとtyped replacement

現行コードではvalidator後commandもParsedWeeklyPlanningCommandとして返る。correction replacementはその既存unionからstate mutationでないbegin/request_clarificationを除外し、accepted bucketを通ったものだけを使う。

~~~ts
type CorrectionTarget =
  | {
      kind: "fact";
      factId: string;
    }
  | {
      kind: "proposal";
      proposalId: string;
    }
  | {
      kind: "command";
      commandId: string;
    }
  | {
      kind: "task";
      taskRef: string;
    }
  | {
      kind: "event";
      eventRef: string;
    }
  | {
      kind: "slot";
      slot: PlanningAssumptionSlot;
    };

type ValidatedCorrectionReplacement = Exclude<
  ParsedWeeklyPlanningCommand,
  {
    type: "begin_weekly_planning" | "request_clarification";
  }
>;

type CorrectionOperation = "replace" | "remove" | "supersede" | "restore";

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

targetは型上ちょうど一種類であり、空targetと複数targetを禁止する。replacement candidateは既存validateInterpretedCandidates相当を通し、acceptedだけをatomic apply候補にする。acceptedWithConfirmationは確認完了まで適用しない。

一つのCorrectionEnvelope内部はatomicである。同turnの複数Envelopeは独立評価し、accepted correctionとrejected correctionが共存できる。unknown/private/stale/別user target、revision/source mismatchはそのEnvelopeだけreject/clarificationとし、元factを破壊しない。restoreは復元可能なsuperseded targetだけ、remove/supersede/restoreはreplacement禁止。

accepted correctionをapplyする同じdeterministic transitionで、status=pendingかつ同じtarget/slot、または訂正・supersedeされたsourceFactRefsへ依存するproposalを検索する。同じtarget/slotへ明示replacementがacceptedされたproposalはsuperseded、前提・target・scopeだけが直接replacementなしに無効になったproposalはexpiredとする。decidedAtTurnId、decidedAtStateRevision、resolvedByのcorrectionまたはreplacement fact参照を記録し、履歴を削除せずpending viewから除外する。旧proposalへのaccept/reject/modifyはnon-pending decisionとして拒否する。correction applyとproposal resolutionはatomicで、rejected correctionはproposalを変更せず、無関係なproposalは不変とする。

accepted decision/correctionはstateRevisionを進め、proposalに依存するpreviewをstaleにし、assumptionDependenciesを再評価して必要なscheduler/feasibilityを再計算する。

## 7. relative range、request、stale、fallback

### 6.1 relative planning range

selected dateとtimezoneをdeterministic contextとして相対日付を解決する。一意解決できる「来週」はaccepted planning rangeにし、planning periodを再質問しない。2026-07-12選択時の「来週」は2026-07-13〜2026-07-19である。「その辺の週」のように一意でない表現だけclarificationへ倒す。

明示range correctionはold rangeをsupersededにし、新rangeをacceptedにする。他のgoal、priority、proposal recordを失わず、previewをstale化してfeasibilityを再計算する。

### 6.2 request envelope

~~~ts
type DialogueTurnEnvelope = {
  conversationId: string;
  turnId: string;
  requestId: string;
  inputStateRevision: number;
  userText: string;
  createdAt: string;
};
~~~

一conversation一active requestとする。

### 6.3 StaleAsyncResult

~~~ts
type StaleAsyncResultReason =
  | "request_id_mismatch"
  | "turn_id_mismatch"
  | "conversation_id_mismatch"
  | "state_revision_mismatch"
  | "cancelled"
  | "mode_reset"
  | "unmounted";

type StaleAsyncResult = {
  kind: "stale_async_result";
  reason: StaleAsyncResultReason;
  conversationId: string;
  turnId: string;
  requestId: string;
  inputStateRevision: number;
};

type StalePreviewApprovalAttempt = {
  kind: "stale_preview_approval_attempt";
  previewId: string;
  previewStateRevision: number;
  currentStateRevision: number;
  previewStale: true;
};

type PendingAssumptionPreviewApprovalAttempt = {
  kind: "pending_assumption_preview_approval_attempt";
  previewId: string;
  previewStateRevision: number;
  pendingProposalIds: string[];
};
~~~

StaleAsyncResultは無言でdiscardし、state、history、status、previewへ反映せず、その結果由来のfallbackも表示しない。

StalePreviewApprovalAttemptは古いpreviewに対するユーザー操作へのdeterministic rejectionである。saveとapproval operation開始を拒否し、「現在条件と一致せず、そのまま保存できないため、最新条件で再計算または最新案の確認が必要」という意味を表示する。PendingAssumptionPreviewApprovalAttemptはpreview revisionが現在と一致していてもpending dependencyが残る操作で、仮定確認後に最新案を再計算するよう案内し、saveとapproval operation開始を拒否する。いずれもAI callとledger作成を行わない。古いAI responseをuser-facing messageなしで破棄するStaleAsyncResultを含め、三者を混同しない。

### 6.4 fallback

- Interpreter failure: provider unavailable/exception/timeout/parse/schema。state適用前でturn-wide rules fallback。追加AI callなし。empty candidatesはfailureでない。
- Dialogue planner failure: invalid action/ref/field/topic/option/formatter/preview、planner exception/timeout。accepted stateを保持し、rules semantic parserを再実行せずdeterministic renderer fallback。追加AI callなし。
- StaleAsyncResult/cancelled: silent discard。ユーザー向けfailure/fallbackを返さない。
- StalePreviewApprovalAttempt: 古いpreviewへのdeterministic user-facing rejection。fallbackではない。
- PendingAssumptionPreviewApprovalAttempt: 現在revisionだがpending dependencyを含むpreviewへのdeterministic user-facing rejection。fallbackではない。

会話/request/proposalはsession-local、既存draft block localStorageは維持し、reloadで自動再実行しない。

## 8. approval ledgerとidempotency

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

idempotency keyはuserId + sourceDraftBlockIdである。approvalOperationIdは監査/batch metadataでありkeyに含めない。別operation IDでも同じuser/source blockから二件目を保存しない。itemごとにpartial failure/retry/crashを扱い、operation statusはitemsから導出可能にする。AIはoperationを作成・開始しない。

保存境界ではUI button状態に依存せず、WeeklyPreviewMetadataのrevision、approvalEligibility、assumptionDependenciesをcanonical proposal stateと再照合する。staleはStalePreviewApprovalAttempt、現在revisionでstatus=pendingが残るものはPendingAssumptionPreviewApprovalAttemptとしてledger作成前に拒否する。rejected/expired/superseded、unknown、private、revision不一致dependencyはblocked_invalidまたはblocked_staleとして拒否する。preview承認をassumption承認として扱わず、repository saveを開始しない。assumption accept/modify後は旧previewをstale化し、accepted factで再計算された最新のeligible previewだけがledger開始へ進める。

## 9. DA2 interaction ownership

DA2はopening once、double submit、button + keyboard重複、active request、reset、history clear、unmount、stale/cancel、IME、keyboard binding、multiline、focus restore、Tab orderのownerである。

IME中に送信しない、multiline入力、button/keyboardの同一turn重複抑止、focus restore、Tab順はstrict contractとする。Enter、Shift+Enter、Ctrl/Meta+Enterの最終割当はDA2実装時に決定し、決定前のroleplayで特定bindingをstrictにしない。

## 10. testとtraceability

strict contractはaction、responseParts、derived used refs/topics/options、field/formatter compatibility、reasonCode/reason renderer、state/revision/request/turn、proposal lifecycle/resolvedBy、decision/correction union、WeeklyPreviewMetadata/assumptionDependencies/approvalEligibility、StaleAsyncResult/StalePreviewApprovalAttempt/PendingAssumptionPreviewApprovalAttempt、fallback、approval ledger、duplicateを検証する。自然文はgolden text完全一致ではなく、敬体、簡潔、no re-ask、仮定/事実の区別、pending assumption説明、内部slot/reasonCode非表示、次入力の明確さをrubric評価する。

P1〜P7 caseとRequirement ID単位の正は[roleplay test plan](../testing/weekly-planning-roleplay-test-plan.md)である。各taskのRequirement IDs、Dependencies、Entry/Exit、roleplay参照は同表と同期する。
新しい必須Requirement IDはDA-READINESS-001、DA-BEHAVIOR-001、DA-RESOLUTION-001であり、同表へ各1行で登録する。

後続implementation taskで、次のpropertyをarchitecture contractとして実装する。

- no premature preview: hard required dimensionが欠けるstateではoptional dimensionだけを追加してもpreview_readyにならない。
- authorization gate: readiness条件が揃っていてもDraftGenerationIntentがuser_authorizedでなければpreviewを生成しない。
- count alone is insufficient: minimumResolvedCountを満たしていてもblocking dimensionまたは高影響uncertaintyがあればpreview_readyにならない。
- order independence: 同じcanonical fact集合へ異なるturn順序で到達しても、矛盾がなければ同じPlanningReadinessSnapshotを生成する。
- irrelevant fact independence: 無関係factを追加してもreadiness、proposal eligibility、preview gateを変えない。
- deterministic hypothesis: 同じcanonical state、policy registry、revisionから同じPlanningHypothesisSnapshotを生成する。
- proposal-first resolution: propose_defaultまたはoffer_optionsがあれば自由回答だけを唯一actionにしない。
- hard constraint preservation: annotation順位付けはhard busy interval、existing plan、timetableと重複しない。
- no availability fabrication: annotationを追加してもavailable minutesの総量を増やさない。
- scope isolation: current weekの習慣factをrecurring profileへ自動昇格しない。
- mutation prohibition: evaluator、behavior derivation、hypothesis builderは入力state、facts、constraints、proposalsを変更しない。
- conflict handling: 矛盾するfactやprofileでは入力順で一方を採用せず、blockingまたはclarificationへ移る。


## 11. current queue

origin/mainにGate P4の検証対象とDA0aの実装・テストが含まれ、DA0a branchはmainへ統合済みであることを確認した。したがってGate P4とDA0aは完了扱いとし、DA0rを次のfoundationとしてDA0より前へ配置する。

| 順 | item | status | dependency |
| --- | --- | --- | --- |
| 0 | Gate P4 | complete — main verification confirmed | src差分の所有者確認 |
| 1 | DA0a assumption proposal foundation | complete — implemented, tested, and merged into main | Gate P4 |
| 2 | DA0r behavior-aware planning readiness foundation | queued | Gate P4、DA0a |
| 3 | DA0 non-exam preview bridge | queued | Gate P4、DA0a、DA0r |
| 4 | DA1 dialogue action/response contract | queued | DA0、DA0r |
| 5 | DA1b assumption decision and correction contract | queued | DA1 |
| 6 | Draft approval idempotency | queued | DA1b |
| 7 | DA2 state-grounded dialogue orchestrator | queued | approval |
| 8 | DA3a relative constraint domain | queued | DA2 |
| 9 | DA3b feasibility consultation | queued | DA3a |
| 10 | DA3c conversation evaluation | queued | DA3b |

DA0rはPlanningDimension、PlanningReadinessPolicy、PlanningReadinessSnapshot、DraftGenerationIntent、MissingResolutionMode、LifeActivityAnchor、TaskExecutionProfile、PlanningOpportunityAnnotation、PlanningHypothesisSnapshot、preview gate、proposal-first next action policyだけを担当する。preview block生成、scheduler全面改修、AI response rendering、assumption lifecycle、save、approval、profile永続化、UI/CSSは扱わない。

DA0はDA0rのreadinessとbehavior derivationを入力に含め、non-exam preview bridgeを実装する。DA1はPlanningHypothesisSnapshotとAllowedDialogueActionsを入力に含める。DA0r、DA0、DA1、DA1bを一つのvertical sliceとして実装することは許容するが、architecture上の責務、module boundary、test boundaryは分離する。

旧D1〜D7、P4〜P9、T6、v3 stageはhistorical/supersededでありcurrent queueへ戻さない。
