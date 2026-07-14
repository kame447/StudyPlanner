# weeklyPlanning 対話アーキテクチャ v4

Status: **canonical / active**
最終更新: 2026-07-14

- Product specification: [weekly-planning-spec.md](../weekly-planning/weekly-planning-spec.md)
- Current roadmap: [weekly-planning-roadmap.md](../ai/strategy/weekly-planning-roadmap.md)
- Contract / roleplay tests: [weekly-planning-roleplay-test-plan.md](../testing/weekly-planning-roleplay-test-plan.md)
- Documentation index: [weekly-planning-docs-index.md](../ai/weekly-planning-docs-index.md)
- Historical records: [weekly-planning-document-archive.md](../ai/closed/weekly-planning-document-archive.md)

## 1. 目的

週間計画機能を、固定slotを順に質問する処理ではなく、accepted factから計画仮説を組み立て、安全な候補を先に提示し、ユーザーの明示許可後だけpreviewを生成する対話型plannerとして実装する。

```text
userText + structured context
  → single AI interpreter
  → typed candidate
  → deterministic normalize / validate / adapter / reducer
  → accepted facts / pending proposals
  → deterministic behavior derivation
  → readiness / resolution opportunities / allowed actions
  → AI dialogue planner
  → response validator / deterministic fallback
  → explicit preview authorization gate
  → existing scheduler / feasibility
  → unsaved preview
  → explicit UI approval
  → save
```

## 2. 不変条件

- provider利用時の自然文意味解釈はsingle AI interpreterを正とする。
- AI出力はtyped candidateまたは許可されたdialogue responseに限定する。
- state更新、readiness、deadline、available minutes、hard constraint、preview可否、approval、save、deleteはdeterministic coreだけが決定する。
- previewは未承認であり、明示的UI approvalまで保存しない。
- AI/rulesのsemantic resultを同一turnでmergeしない。provider failure時だけturn-wide rules fallbackへ切り替える。
- empty candidatesは正常結果であり、provider failureとして扱わない。
- user-originated stringをaction ID、fact ref、option ID、formatter ID、内部命令へ昇格させない。
- planning hypothesis、未承認anchor、pending profile、readinessをrepositoryやlocalStorageへ永続化しない。
- LifeActivityAnchorとPlanningOpportunityAnnotationはavailabilityを新設・拡張しない。
- hard busy interval、existing plan、timetable、bufferをbehavior scoreより常に優先する。
- stale async resultはstateへ適用しない。stale preview approvalはdeterministicに拒否する。

## 3. 責務境界

### 3.1 AI interpreter

- current user turn、直近会話、structured stateを読む。
- typed candidateを返す。
- state、scheduler、repositoryを直接変更しない。

### 3.2 validator / adapter / reducer

- candidate shape、enum、値域、source、revision、参照可能性を検証する。
- accepted candidateだけをcanonical stateへ反映する。
- rejected candidate、clarification、pending proposalをaccepted factと分離する。

### 3.3 deterministic behavior core

次をpureまたはdeterministicに導出する。

- `PlanningDimension`
- `PlanningReadinessPolicy`
- `PlanningReadinessSnapshot`
- `DraftGenerationIntent`
- `LifeActivityAnchor`
- `TaskExecutionProfile`
- `PlanningOpportunityAnnotation`
- `MissingResolutionOpportunity`
- `PlanningHypothesisSnapshot`
- `AllowedDialogueAction`
- `PreviewGateResult`

### 3.4 AI dialogue planner

- accepted factsの表示用要約、PlanningHypothesisSnapshotの表示可能部分、AllowedDialogueActions、直近会話だけを受け取る。
- 通常1〜2件、最大3件のactionを選ぶ。
- 許可されていないaction、option、proposal、deadline、時刻、preview結果を作らない。

### 3.5 response validator / fallback

全ユーザー表示文字列を検査する。

- `acknowledgement`
- `items[].text`
- `reasoningSummary`

次を拒否する。

- unknown field
- AllowedDialogueActions外のaction
- selected actionとitemsの不一致
- action上限超過
- 未許可option / proposal
- preview gate未通過のpreview claim
- 内部slot、reasonCode、readiness、source refの露出
- 保存・確定・登録済みと誤認させる表現

validation、schema parse、providerの失敗時はdeterministic fallbackへ戻る。

### 3.6 preview bridge

既存schedulerを呼ぶ条件は次のすべてである。

```text
readiness.stage == preview_ready
DraftGenerationIntent == user_authorized
blockingDimensions is empty
stateRevision matches current revision
all work items have execution shape
validated availability basis exists
```

`hypothesis_ready`、`proposal_ready`、`assistant_suggested`ではschedulerを呼ばない。

## 4. DraftGenerationIntent

```ts
type DraftGenerationIntent =
  | "not_requested"
  | "assistant_suggested"
  | "user_authorized";
```

- 漠然とした学習goalは`not_requested`。
- assistantの候補提示だけではpreview不可。
- `user_authorized`はtyped authorization command → closed validator → deterministic reducerを通す。
- authorization revisionとcurrent state revisionが一致する場合だけpreview gateで有効とする。
- AI dialogue responseだけでintentを変更しない。

## 5. Readiness

minimum resolved countは補助情報であり、単独でstageを決定しない。

non-exam previewでは少なくとも次をblocking判定へ参加させる。

- planning range
- task identity
- workload
- task execution profile
- validated availability basis
- taskに紐づく高影響deadline uncertainty
- current revision authorization

`fixedEventsDeclaredNone`だけではavailability basisにならない。schedule sourceは実データの存在を再検証する。

## 6. Behavior derivation

### LifeActivityAnchor

帰宅、食事、睡眠、就寝前、学校、仕事、固定予定などをsource ref、origin、scope、confidence付きで導出する。current turnまたはcurrent weekの情報をrecurring profileへ自動昇格しない。

### TaskExecutionProfile

暗記、演習、読解、執筆、問題解決、project、復習などを有限policyから導出する。StudyTaskScopeを置き換えず、明示factとdeterministic derivationを区別する。

### PlanningOpportunityAnnotation

既存available rangeへ`after_commute`、`before_sleep`、`before_meal`、`after_meal`、`long_contiguous_window`等を付加する。available minutesは変更しない。

現行vertical sliceでは、明示された帰宅時刻、studyAvailableStart、朝回避をscheduler入力の下限として狭める。behavior情報によって時間を増やさない。

## 7. Deadline

「テスト」「試験」または曜日が存在するだけではdeadlineを解決しない。

- taskと同じ節・同じidentityに紐づく具体日
- planning range内で一意に解決できるtask-linked weekday
- 明示されたdeadline fact

のいずれかを必要とする。別予定の曜日をtask deadlineへ流用しない。

## 8. Preview metadata

behavior-aware previewでは次を追跡可能にする。

- stateRevision
- sourceFactRefs
- usedAssumptionProposalRefs
- taskRef
- opportunityTags
- deterministic reasoning key
- compatibility adapter metadata

metadataはpreview blockと未承認draft blockのsidecarとして保持し、内部コードをユーザーへ表示しない。個別削除はstable keyでcandidate、preview block、metadataを同時に除去する。

## 9. Fallbackと互換経路

- exam flowは移行期間中、既存decision / renderer / scheduler contractを維持してよい。
- non-exam taskを既存exam-oriented scheduler contractへ渡す場合はcompatibility adapterで明示する。
- legacy fallbackはrules mode専用の暫定経路とし、新しいsemantic patternを追加し続けない。
- scheduler全面書換え、save/approval再設計、profile永続化は個別taskで扱う。

## 10. 現在の実装状態

2026-07-14時点で次は実装・自動検証済みである。

- Gate P4
- DA0a assumption proposal foundation
- DA0r behavior-aware readiness foundation
- 最小behavior derivation
- DA0 non-exam preview bridge
- DA1 allowed action / AI response contract
- hardened authorization / availability / deadline / validator境界
- preview metadata sidecar
- actual weekly-planning entrypoint接続
- targeted tests 38件
- full tests 825件
- TypeScript / build / diff check

実ブラウザroleplayは自動ブラウザ環境の中断により未完了である。

## 11. Open queue

実行単位の正は`docs/ai/tasks/`直下の未完了taskだけとする。

1. DA1b assumption decision and correction contract
2. Draft approval idempotency
3. DA2 state-grounded dialogue orchestrator
4. DA3a relative constraint domain
5. DA3b feasibility consultation
6. DA3c conversation evaluation

次の補強は上記taskへ統合して扱う。

- `assistant_suggested`のcanonical transition
- assumption accept / reject / modify lifecycle
- opportunity annotationのplacement score活用
- authorization commandの共通command registryへの統合
- stale / pending preview approval guard
- manual browser roleplay

## 12. 非目標

- scheduler全面書換え
- UI/CSS全面変更
- 自動save / approve / delete
- profileまたは会話履歴の無断永続化
- complex recurrence / sharing
- ML/LLMによるstate直接更新
- 一度の発話からrecurring profileを作ること

## 13. テスト契約

自然文の完全一致ではなく、state transition、action、refs、revision、gate、metadata、fallbackをstrictに検証する。

最低限の性質は次である。

- no premature preview
- authorization gate
- count alone is insufficient
- deterministic hypothesis
- proposal-first resolution
- hard constraint preservation
- no availability fabrication
- scope isolation
- mutation prohibition
- conflict handling
- preview stable identity / individual deletion
- provider failure fallback

具体的scenarioとRequirement IDは[weekly-planning-roleplay-test-plan.md](../testing/weekly-planning-roleplay-test-plan.md)を正とする。
