# Weekly Planning Regression Scenarios

Status: canonical scenario catalog
Updated: 2026-08-23

Parent: [test-philosophy.md](test-philosophy.md)
Contract: [../architecture/current-contract-v5.md](../architecture/current-contract-v5.md)
Scheduling: [../policies/scheduling.md](../policies/scheduling.md)

## Purpose

この文書は、historical V4 roleplay/task/auditに埋もれていた**version非依存の回帰条件**をcurrent contractへ移管する。

古い型名、parser名、branch名、固定日本語は再利用しない。各scenarioはcurrent Stable V5のmachine state / typed contract / observable product behaviorとして検証する。

## 1. Scheduling safety

### SCHED-001: seventh-day reserve

7日horizonでは、hard constraintがreserve利用を要求しない通常ケースで、最初の6日をnormal placementとして優先し、7日目をreserveとして保持する。

Evidence owner:
- `src/features/weeklyPlanning/semantic/weeklyPlanningStableV5DistributionPolicy.test.ts`

### SCHED-002: balanced normal-day load

normal daysの一日へ不必要に集中させず、current distribution policyのtarget load / soft-cap behaviorに従う。

soft cap定数の変更自体は許可するが、意図せず「一番空いている日に全量を詰める」回帰を起こさない。

### SCHED-003: not-before

request-timeより前へ新しいfuture plan blockを置かない。

calendarの選択日を過去へ動かしても、このhard lower boundを回避しない。

### SCHED-004: authoritative busy source

existing StudyPlanner plans / timetable / accepted hard unavailable intervalと重複しない。

required source load failureをempty sourceとして扱わない。

### SCHED-005: life constraint integrity

accepted sleep/life/buffer constraintは、そのtyped scopeでavailabilityを実際に狭める。

sleep endを自動的にstudy-available startとみなさない。

### SCHED-006: atomic work integrity

`atomic` work itemをscheduler都合で分割しない。splittableとtypedに確定したworkのみmechanical chunkingを許可する。

## 2. Quantity / progress

### PROG-001: target and progress are distinct

`scope_total=20`, `completed=12`から`remaining=8`を導出できても、「今回8全部をやる」とは自動決定しない。明示`target=4`なら、今回のscheduler workはtarget semanticsに従う。

### PROG-002: bounded progress convergence

同じactive factsなら、`scope_total → completed`と`completed → scope_total`の入力順に関係なく同じremainingへ収束する。

### PROG-003: correction invalidates derivation

progress basisを訂正した場合、以前のtotal/completedから導出されたstale remainingをactiveなtruthとして残さない。

### PROG-004: open-ended work has no fabricated total

総量が存在しない/分からないworkへ、割合計算や分配の都合だけで架空のscope totalを作らない。

### PROG-005: zero completed history does not block planning

完了済みworkが0件、または過去実績が存在しないことだけを理由に週間計画を拒否しない。

必要なscope / target / effort / availabilityが揃っていれば、未着手からでもplanning/scheduler pathへ進める。

Historical evidence came from the old zero-progress draft regression, but current validation should target Stable V5 work compilation/readiness rather than the old intake adapter shape.

## 3. Dialogue / grounding

### DIALOGUE-001: known information is not re-requested

existing plans / accepted facts等のauthoritative known contextがある場合、同じ情報を最初から入力させず、必要な追加・差分だけを尋ねる。

### DIALOGUE-002: repair blocking issue first

hard ambiguity、required effort、authorization等のblocking issueは、その先のdecisionに必要な時点でrepairする。

### DIALOGUE-003: pass over low-impact uncertainty

low-impact uncertaintyが残っていてもsafeに進められる場合はdeferできる。deferred issueはmachine stateから消さず、影響を持つ境界より前にreopenする。

Current example owner:
- `src/features/weeklyPlanning/application/weeklyPlanningStableV5RepairAgendaIntegration.test.ts`

### DIALOGUE-004: proposal is not acceptance

application/assistantがproposalを提示しただけではaccepted stateへ入れない。userのaccept/modify/rejectをsemantic layerで解釈し、applicationがlifecycleを確定する。

### DIALOGUE-005: ambiguous reference fails safe

referentが一意でない状態で、特定task/sourceへ勝手にhard bindしない。raw-text keyword guardで参照解決を代替しない。

### DIALOGUE-006: current-week acceptance does not become durable memory

`今回は夜で`等のweek/session local acceptanceを、`今後も夜が好き`というdurable preferenceへ暗黙昇格させない。

## 4. Preview / approval

### PREVIEW-001: no premature preview

blocking readinessが未解決、必要authorizationがない、またはpreviewを安全に生成できないstateではpreviewを生成しない。

### PREVIEW-002: stale preview rejection

preview生成後にaccepted semantic state / source revisionが変わった場合、古いpreviewをそのままsaveしない。

### PREVIEW-003: pending proposal is not saved truth

未了承proposal、previewに影響する未解決assumption、必要なdeferred repairを保存済みPlanへsilent applyしない。

### PREVIEW-004: approval idempotency

同じpreview/itemへのretry、response loss、multi-client approvalでduplicate Planを作らず、同じoperation/item identityへ収束する。

### PREVIEW-005: individual pre-approval removal

ユーザーは承認前の仮予定を1件ずつ除外できる。除外操作は正しいcandidate/block identityだけへ作用し、別の仮予定や保存済み予定を消さない。

この能力はhistorical MVPで基本操作として実装済みだった。current application facadeにも`removePreviewCandidate` / `removeDraftBlock`が存在するが、2026-08-23監査時点のdedicated `AiPlanningView`週プレビューには個別削除UIが確認できない。

したがってこれは**current UI regression candidate**としてIssue #52の専用画面分離完了条件で検証する。

### PREVIEW-006: bulk discard / approval remain coherent

個別除外を実装・移行しても、一括破棄/再調整と明示承認のboundaryを壊さない。preview candidateとpromoted draftのどちらを操作しているかをUI/applicationで一貫させる。

## 5. Lifecycle / state integrity

### STATE-001: rejected semantic turn preserves accepted state

provider/normalization/canonicalization failureが、以前のaccepted Graphを部分的に壊さない。

### STATE-002: no-op does not create semantic mutation

意味上の変更がないturnで、不必要なFact/revision/derived mutationを作らない。

### STATE-003: proposal/correction lifecycle is explicit

correction、supersession、proposal resolutionを単なる上書きやrenderer textから推測せず、explicit machine lifecycleとして扱う。

### STATE-004: derivation does not mutate source input

projection/derivationは入力stateを暗黙破壊せず、同じaccepted basisから再計算可能である。

## 6. Invariance properties

### INV-001: order independence where domain facts commute

入力順だけで最終accepted truthが変わるべきでないdomainでは、同じfactsの順序違いが同じ結果へ収束する。

すべての会話turnが可換という意味ではない。訂正、明示的な時間順依存、lifecycle operationはそのcontractに従う。

### INV-002: irrelevant-fact independence

対象decisionと独立なfactを追加しただけで、既存hard constraintやquantity truthが変化しない。

### INV-003: annotation does not create availability

preference/annotation/profile scoreは、hard available spaceを新設・拡大しない。

## 7. Scenario requiring explicit current-contract verification

### AUDIT-001: mixed turn partial acceptance

Historical contracts contained an important expectation:

```text
one utterance
├─ independently valid new fact
└─ another ambiguous/clarification-requiring contribution
```

Ideally, an unrelated valid contribution should not be forgotten merely because another part needs clarification. However, current Stable V5 canonical commit is atomic at the document/commit boundary, and this audit has not yet proven a universal candidate-level partial-acceptance guarantee for every mixed turn.

Therefore this item is **not declared as a blanket current invariant yet**.

Required audit:

1. verify current focused side-contribution/contextual-answer tests and production path;
2. define which mixed contributions may be accepted atomically together and which must fail the whole turn;
3. if current behavior drops independently valid contributions unnecessarily, track a current Issue/work item;
4. do not implement partial acceptance with raw Japanese regex/keyword routing.

This section remains visible so the principle is not lost merely because its historical implementation task was superseded.

## Archive relationship

Historical sources remain under `docs/archive/weekly-planning/` and `docs/archive/work/` as evidence. They are not current test instructions.

If a historical scenario is still valuable, extract its invariant here and point current automated tests at the current Stable V5 owner. Do not move the whole old test plan back into current documentation.
