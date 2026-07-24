# 週間計画 AI ロードマップ

Status: canonical / active
最終更新: 2026-07-24
Reviewed main baseline: `a669b166db30fa3f355371c089062eb5cf4e3987`

- Runtime and local persistence: [../weekly-planning-stable-v5-runtime-trial-contract.md](../weekly-planning-stable-v5-runtime-trial-contract.md)
- Current contract status: [../weekly-planning-current-contract-status.md](../weekly-planning-current-contract-status.md)
- Semantic V5 roadmap: [weekly-planning-semantic-v5-roadmap.md](weekly-planning-semantic-v5-roadmap.md)
- Trace continuity audit: [../audits/20260724-stable-v5-trace-continuity/final-overseer.md](../audits/20260724-stable-v5-trace-continuity/final-overseer.md)
- Cloud session store: [../tasks/20260716-weekly-planning-synced-conversation-session-store.md](../tasks/20260716-weekly-planning-synced-conversation-session-store.md)
- Approval rollout: [../tasks/20260718-weekly-planning-approval-operational-rollout.md](../tasks/20260718-weekly-planning-approval-operational-rollout.md)

## 1. Statusの読み方

```text
module implemented
→ runtime connected
→ local persistence connected
→ automated verified
→ browser verified
→ cloud synced
→ operationally deployed
```

上記を同一視しない。PR本文または過去completion recordのtest成功は、その時点のheadに対する記録であり、現在の`main`、実browser、本番Firestore設定へ自動継承しない。

## 2. 現在の実装基盤

### 2.1 semanticと対話

実装済み:

```text
AI-only initial semantic interpretation
Stable V5 direct schema / validator / canonicalizer
Fact Graph V5 lifecycle
short-answer contextual binding
deterministic missing priority / dialogue
provider failure時のfail closed
parser fallback禁止
```

PR #77とPR #79は`main`へ統合済みである。Stable V5はfeature flag付きで既存UIへ接続済みであり、defaultは環境変数で変更されない限りlegacyである。

### 2.2 previewとapproval

実装済み:

```text
session-owned preview
request ownership / stale result rejection
preview revision freshness
approval専用save boundary
server transaction idempotency
deterministic Plan ID
owner-bound local storage
```

未完了:

```text
実browser close / reopen / reload / IME / focus / reset / week switch
本番Firestore rules deploy
approval operation / item TTL
Firestore Emulator rules / transaction tests
2tab・2端末相当の確認
```

### 2.3 Stable V5 local persistence

2026-07-23以後、conversation、Fact Graph、preview、draftをownerとweekへ拘束したlocal envelopeへ同時保存する。ページ再読込後は同じconversation IDとGraph revisionを復元する。pending request ownershipは保存しない。

これは同一browser profile内のlocal persistenceであり、cloud authoritative session storeではない。

### 2.4 quality trace continuity

PR #83以前はphysical trace session ID、sequence、turn index、request dedupe、server handleがruntimeまたはrepository instance memoryへ依存し、同じconversationがreload、30分idle、repository再生成で別ログへ分割された。`clear_conversation`後のreloadではrequest IDも再利用し得た。

PR #83で次を修正する。

```text
user ID + conversation IDのcontinuity scope
stable local physical session identity
sequence / turn index continuity
PlanningState revisionによるcontroller sequence下限
bounded request dedupe
idle timeout split廃止
server-issued handle persistence
repository recreation後のhandle再利用
structural rejection時だけhandle再発行
transient failure時のsame-payload retry
append成功後だけcounter commit
```

過去分割済みlogsは自動mergeしない。abrupt page close時の最終trace durabilityは後続課題である。

### 2.5 personalization

account-linked profile foundationは実装済みである。week start、origin、confidence、scope、confirmedAt、expiresAt、settings変更、profile resetを持つ。一時的な相談条件をlongitudinal profileへ自動昇格しない。

未完了は、current-time boundary、cloud session sync、相談resetと派生観測無効化、plan/actual observation、時間減衰、不確実性、placement score、data governanceである。

## 3. Current queue

`docs/ai/tasks/`直下には未完了taskだけを置く。semantic V5固有queueはsemantic V5 roadmapを正とし、それ以外を本roadmapで管理する。

### P0: regression and scheduler safety

1. PR #83 trace conversation continuity
   - 同一logical conversationを一つのphysical trace sessionへ継続する。
   - reload、1時間idle、clear後reload、remote repository recreation、write failureを回帰testする。
   - focused tests、full suite、TypeScript、build、browser reload確認を完了する。
   - 七視点監査とcanonical MDを同期する。

2. `20260716-weekly-planning-midweek-current-time-start-boundary.md`
   - 明示開始がない今週計画で、現在時刻より前へ候補を生成しない。
   - request単位のcurrentDateTimeとplanning horizon開始境界を確立する。

### P1: production boundary and data governance

3. `20260716-weekly-planning-entrypoint-request-ownership.md`
   - controller/envelope実装後のbrowser verificationを完了する。

4. `20260716-weekly-planning-trace-privacy-and-lifecycle.md`
   - traceの本番secret、TTL、削除、限定閲覧、audit、privacy/legal reviewを完了する。
   - abrupt page close時のfinal-turn durabilityを別work unitとして評価する。

5. `20260716-weekly-planning-longitudinal-personalization-data-governance.md`
   - 同意、保持、訂正、削除、権限、監査、本番運用を完了する。

6. `20260718-weekly-planning-approval-operational-rollout.md`
   - 本番rules、operation/item TTL、Emulator、multi-client確認を完了する。

7. `20260716-weekly-planning-synced-conversation-session-store.md`
   - cloudを共有正本とする週単位session repositoryを実装する。
   - 別端末復元、revision競合、offline cache、local migrationを扱う。
   - local persistence完了を本task完了へ読み替えない。

8. `20260716-weekly-planning-consultation-reset-and-invalidation.md`
   - cloud session store確立後に、相談resetと未承認仮予定・派生観測の無効化を原子的に実装する。

### P2: observation and maintainability

9. `20260716-weekly-planning-history-feature-extraction.md`
   - 計画、承認、実績をversion付き観測へ変換する。

10. `20260716-weekly-planning-trace-scalability-and-schema-migration.md`
    - pagination、query cost、index、archive、schema decoderを設計する。

11. `20260716-weekly-planning-controller-ui-responsibility-split.md`
    - conversation controller、preview controller、view componentへ責務を分離する。

### P3: profile aggregation

12. `20260716-weekly-planning-user-profile-time-decay.md`
    - 有効観測だけから、時間減衰、観測数、不確実性を持つ再計算可能profileを構築する。

### P4: personalized selection

13. `20260716-weekly-planning-personalized-placement-scoring.md`
    - hard constraints通過後の候補だけを個人別scoreで並べ替える。
    - profile不足または計算失敗時は現行heuristicへ戻す。

## 4. 実装依存順

```text
Stable V5 runtime + local persistence
→ PR #83 trace continuity
→ current-time start boundary
→ cloud synced weekly session store
→ consultation reset / invalidation
→ planning and outcome observations
→ decayed profile aggregation
→ personalized placement score
```

trace privacy、approval rollout、personalization data governanceは並行P1で進める。ただし、同意前にaccount-linked observationまたはprofileを作成しない。

## 5. Decision gates

### 5.1 semantic ownership — decided

raw user textの意味構造化はAI interpreterだけが担当する。deterministic coreはschema、reference、revision、conflict、readiness、feasibilityを管理する。provider failureでもparserへfallbackしない。

### 5.2 Stable V5 persistence — local implemented / cloud incomplete

同一browser profile内ではconversationとGraphを同時復元する。別端末、cloud revision、offline conflict、migrationはP1 session storeへ残る。

### 5.3 trace identity — fix in PR #83

physical trace sessionはlogical conversationへ一対一で拘束する。idle timeを会話終了条件にしない。controller IDはmessagesが消去されてもrevision下限より後を発行する。server handleはrepository lifetimeを越えて継続し、明示的structural rejection時だけ再発行する。

### 5.4 week start — foundation implemented

初回選択をaccount-linked profileへ保存し、以後の「今週」「来週」に適用する。発話中の具体日付を優先する。

### 5.5 personalized data — operational work incomplete

quality trace、conversation session、personalization profile、approval ledgerを別schema、別repository、別identity、別削除責務で管理する。原会話をそのままlongitudinal profileとして使用しない。

## 6. PR #83 merge gate

```text
focused trace tests success
full test suite success
TypeScript success
Vite production build success
git diff --check success
七視点監査更新
canonical MD更新
unresolved review thread 0
browser reload・1時間idle・clear後reloadで同一ログ継続確認
admin export確認
```

PR #83は上記完了までDraftを維持する。GitHub Actionsがstep 0件でrunner起動前に失敗した場合、code test failureとは区別するが、成功証跡としても扱わない。browser verificationを実行できない場合は未確認と明示し、automated verificationだけで採用可と断定しない。
