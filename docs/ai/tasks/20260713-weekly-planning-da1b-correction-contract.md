# DA1b: assumption decision and correction contract

Status: **ready**
Priority: highest
Parent: [weekly-planning-dialogue-architecture-v4.md](../../architecture/weekly-planning-dialogue-architecture-v4.md)
Roadmap: [weekly-planning-roadmap.md](../strategy/weekly-planning-roadmap.md)
Traceability: [weekly-planning-roleplay-test-plan.md](../../testing/weekly-planning-roleplay-test-plan.md)
Requirement IDs: DA-ASSUMPTION-001, DA-CORRECTION-001, DA-PREVIEW-001, DA-SAFE-001
Dependencies: behavior-aware vertical slice completed

## 1. Purpose

現在のbehavior-aware pipelineへ、pending assumptionの明示decisionと、accepted fact/task/range/constraintのcorrection lifecycleを接続する。

```text
pending proposal
→ accept / reject / modify
→ deterministic validation
→ proposal record transition
→ accepted fact or replacement proposal
→ state revision
→ preview stale / recompute
```

AI dialogue responseだけでproposal statusやaccepted factを変更しない。

## 2. Scope

- `accept_assumption`
- `reject_assumption`
- `modify_assumption`
- `replace`
- `remove`
- `supersede`
- `restore`
- target resolution
- proposal history / resolvedBy
- related proposal supersede / expire
- state revision
- preview stale / dependency reevaluation
- `assistant_suggested` canonical transition
- authorization commandの共通command registry統合

## 3. Non-goals

- approval ledger / repository save
- scheduler全面改修
- UI/CSS再設計
- recurring profile永続化
- DA2 request orchestration
- DA3 feasibility dialogue
- automatic assumption acceptance

## 4. Required boundaries

- decisionとcorrectionはtyped candidateを使う。
- validator通過前にstateへ適用しない。
- one correction envelopeはatomic。
- same turnの複数envelopeは独立評価し、acceptedとrejectedが共存できる。
- rejected correctionはaccepted factとproposal recordを変更しない。
- unknown、private、stale、別conversation、revision mismatch targetを適用しない。
- pendingでないproposalへのdecisionを拒否する。
- AI free textをreplacement valueやtarget refとして使わない。

## 5. Proposal lifecycle

```ts
type AssumptionProposalStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "superseded"
  | "expired";
```

各recordは最低限次を追跡する。

- proposalId
- conversationId
- target / slot
- sourceFactRefs
- created turn / revision
- decided turn / revision
- status
- resolvedBy
- replacement proposal ref if modified

`modify_assumption`は旧recordをsupersededにし、新しいproposalまたは明示factを生成する。元recordを上書きしない。

## 6. Correction lifecycle

Correction targetはdiscriminated unionとし、ちょうど一種類だけを指定する。

- task
- planning range
- constraint
- priority
- accepted fact
- proposal

replaceはvalidator accepted済みreplacement commandを必要とする。remove / supersede / restoreではreplacementを禁止する。

accepted correctionと同じdeterministic transitionで関連pending proposalを解決する。

- explicit replacementが同じtarget / slotを置換した場合: superseded
- targetや前提だけが無効になった場合: expired
- unrelated proposal: unchanged

## 7. Preview behavior

accepted decisionまたはcorrectionはstate revisionを進める。

- old previewをstaleにする
- behavior metadataとassumption dependenciesを再評価する
- schedulerが必要な場合だけ再実行する
- old preview approvalを拒否する
- preview approvalをassumption acceptanceとして扱わない
- saveは行わない

## 8. Acceptance scenarios

### Accept

```text
User: その仮定で進めて
Expected:
- target pending proposal resolved
- status=accepted
- decided turn/revision recorded
- preview regenerated only through current gate
```

### Reject

```text
User: その時間は長すぎる
Expected:
- status=rejected
- accepted goal/task remains
- same proposal is not implicitly reactivated
```

### Modify

```text
User: 英語は90分で
Expected:
- old proposal superseded
- replacement fact or new proposal created
- resolvedBy connects records
```

### Mixed correction

```text
User: 数学は外して。英語は60分にして。夜の分も動かして
Expected:
- unambiguous task removal accepted
- unambiguous English replacement accepted
- ambiguous night reference rejected or clarified
- accepted and rejected envelopes coexist
- preview becomes stale
```

## 9. Tests

Minimum contract tests:

- accept / reject / modify discriminated union
- invalid union shape rejected
- stale revision rejected
- proposal history preserved
- resolvedBy recorded
- correction/proposal resolution atomicity
- unrelated proposal unchanged
- mixed accepted/rejected envelopes
- old decision rejected after supersede
- preview stale after accepted change
- assistant_suggested does not generate preview
- shared authorization command still requires current revision
- input state is not mutated by validators

Roleplay coverage:

- `WP-DA-001` branches 5a / 5b / 5c
- correction turns 6 / 10 / 11
- `WP-BEHAVIOR-001` assistant suggestion → user authorization boundary

## 10. Validation

```bash
npx vitest run <DA1b targeted tests>
npx tsc --noEmit
npm run build
npm test -- --run
git diff --check
git status -sb
```

Git operations are prohibited unless explicitly requested.
