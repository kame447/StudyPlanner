# weeklyPlanning dialogue stack verification on `main`

Status: ready / verification only
Priority: P0
Target branch: `main`
Current merge baseline: `55f8e32c68cfd057494fadec0ed208cba267db12`
Post-merge status: `docs/ai/weekly-planning-pr5-post-merge-status.md`
Production code change: prohibited
Test code change: prohibited
Git add / commit / push: prohibited

## 1. Purpose

`main`に存在するPR #5 conversation/session hardening、DA1b、approval、DA2、DA3a、DA3b、DA3cのmoduleと接続状態について、compile、test、build、production entrypoint、browser behaviorを検証する。

moduleが存在すること、unit testが通ること、production entrypointへ接続されていること、browserで契約が成立することを別々に判定する。失敗時はコードを変更せず、原因と再現情報だけを報告する。

このtaskではIssue #21の漢数字日付bugを修正しない。再現した場合はknown failureとして記録し、専用taskを参照する。

## 2. Current lifecycle contract

```text
modal close / presentation component unmount
  → session cancelではない
  → request完了resultをsessionへcommitし、reopen時に復元できる

selected week変更 / session reset / explicit cancellation / revision mismatch
  → 旧resultを現在stateへ適用しない

browser reload中のpending ownership
  → network requestは再開しない
  → load時にpending ownershipをsanitizeする
```

旧「reset、close、unmountをすべて同じcancelとして扱う」記述は使用しない。

## 3. Phase 1: repository state

最初に次を確認する。

```sh
git branch --show-current
git status -sb
git log -1 --oneline
```

- branchが`main`でない場合は切り替えず、実際のbranchを報告して停止する。
- working treeに差分がある場合は、差分を変更せず報告する。
- 本task開始時のHEADを最終報告へ残す。
- HEADが`55f8e32`以降の場合は、追加commitを明示する。

## 4. Phase 2: targeted tests

既存のdialogue-stack testsに加え、PR #5のsession、storage、range、preview lifecycleを対象にする。実在するtest pathを確認してから実行し、存在しない旧pathを推測して追加しない。

対象category:

- assumption lifecycle
- approval、legacy approval、pending/stale guard
- dialogue orchestrator、UI policy
- relative constraints、feasibility
- behavior-aware roleplay
- conversation/session persistence
- session-owned async preview lifecycle
- reducer/property contract
- storage v2/legacy/malformed validation
- pending planning range
- contextual fixed events
- deterministic baseline + AI enrichment
- explicit repair / pass-over / grounded acknowledgement

実行例:

```bash
npx vitest run \
  src/features/weeklyPlanning/planning/weeklyPlanningAssumptionLifecycle.test.ts \
  src/features/weeklyPlanning/planning/weeklyPlanningApproval.test.ts \
  src/features/weeklyPlanning/planning/weeklyPlanningApprovalLegacy.test.ts \
  src/features/weeklyPlanning/planning/weeklyPlanningApprovalAssumption.test.ts \
  src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueOrchestrator.test.ts \
  src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueUiPolicy.test.ts \
  src/features/weeklyPlanning/planning/weeklyPlanningRelativeConstraints.test.ts \
  src/features/weeklyPlanning/planning/weeklyPlanningFeasibility.test.ts \
  src/features/weeklyPlanning/__tests__/weeklyPlanningBehaviorAwareRoleplay.test.ts
```

PR #5固有testはrepository内の現在pathを列挙して追加する。

## 5. Phase 3: full validation

```bash
npx tsc --noEmit
npm run build
npm run test:run
git diff --check
git status -sb
```

package scriptが異なる場合は`package.json`の現在scriptを正とし、実際に使用したcommandを報告する。

Use Node 20 or later. `node_modules`、lockfile、repository configurationを検証結果だけ変える目的で変更しない。

## 6. Phase 4: production entrypoint inspection

module単体の存在やtestだけで接続済みと判定しない。次を静的に確認する。

### Request ownership

- 実際の週間計画UI entrypointがどのownerからturnを開始するか。
- request envelopeにconversation、turn、request、state revision、対象週が含まれるか。
- active request中の二重送信を防ぐか。
- selected week変更、session reset、explicit cancel後の旧resultを適用しないか。
- presentation componentのunmountだけで有効request ownerを失わないか。
- retry時に新しいrequest/turn identityを発行するか。

### Session and preview

- user発話、assistant応答、intake、preview candidateがsession stateへcommitされるか。
- modal close中に完了したpreviewを再表示時に復元できるか。
- clear conversationとreset sessionが別operationか。
- preview個別削除、全破棄、draft昇格がstable identityで処理されるか。

### Storage

- closed validatorがintake、draft、preview、behavior metadataを検査するか。
- v2とlegacy loadが同じsanitize boundaryへ入るか。
- pending turn、pending approval、session-local proposal recordだけを除去し、messagesと入力済み条件を保持するか。

### Keyboard and UI

- keyboard policyが実際のtextareaとsubmitへ接続されているか。
- IME composition中のEnterを送信しないか。
- Enterが改行、Ctrl/Meta+Enterが送信として一系統で接続されるか。
- 完了・失敗後にfocusを復元するか。

### Approval

- approval pathが実保存境界へ接続されているか。
- stale/pending previewをledger/repository開始前に拒否するか。
- localStorage ledgerの保証範囲をmulti-device保証と誤記していないか。

未接続または部分接続の場合は、対象fileと不足する不変条件を報告する。修正は行わない。

## 7. Phase 5: manual/browser scenarios

### 7.1 Behavior-aware preview

1. Vague goal does not generate preview.
2. Deadline、workload、life anchors are accepted separately.
3. Assistant suggestion does not generate preview.
4. Explicit user authorization generates the first preview.
5. Relative commute/buffer does not overlap the anchor or hard plans.

### 7.2 Deterministic baseline and AI enrichment

1. deterministic parserが年度範囲だけを取得する。
2. AIが分野属性を補完する。
3. 既存の確定属性をAIが破壊的に上書きしない。
4. 単一分野ではpriority質問を省略する。
5. 複数分野ではpriority確認を維持する。

### 7.3 Planning range

1. 「夏休みに計画を立てたい」で期間名を保持し、開始日・日数を未確定にする。
2. 続く「8月1日から一週間」で開始日と7日を補完する。
3. pending `来週`をselected date基準で保持し、current dateで上書きしない。
4. pending範囲外の算用数字絶対日付を範囲内曜日へ変換しない。
5. 漢数字絶対日付はIssue #21のknown failureとして再現有無を記録する。

### 7.4 Close and resume

1. 「週間計画」を選択する。
2. 入力欄へ文章を入力する。
3. 送信ボタンを押す。
4. Promise待機中にmodalを閉じ、presentation componentを外す。
5. Promise完了後にmodalを再表示する。
6. 次のすべてをassertする。
   - userが入力した文章
   - assistantの応答
   - previewの内容
   - draft昇格操作

closeをStaleAsyncResultとして破棄しない。

### 7.5 Invalidation

1. active request中にselected weekを変更する、またはsession reset / explicit cancelを実行する。
2. 旧resultをstate、history、status、previewへ適用しない。
3. stale resultをfallbackまたはerror messageへ変換しない。
4. retryは新しいrequest/turn identityを使用する。

### 7.6 Assumption lifecycle

1. pending duration proposalを明示acceptできる。
2. rejectしてもproposal historyを削除しない。
3. modifyが旧proposalをsupersedeしreplacementを作る。
4. task correctionが無関係taskを保持する。
5. stale proposal decisionを拒否する。

### 7.7 Approval

1. current eligible previewを保存できる。
2. pending-assumption previewをsave前に拒否する。
3. stale previewをsave前に拒否する。
4. 同一browser内の繰り返しapprovalでduplicate planを作らない。
5. 一件失敗後、完了itemを再保存せず未保存itemだけretryする。
6. existing exam draft approvalが動作する。
7. multi-tab・別端末は未保証として分類する。

### 7.8 Keyboard and focus

1. IME composition中に送信しない。
2. Enterは改行する。
3. Ctrl/Meta+Enterは一回だけ送信する。
4. buttonとkeyboardの同時発火で二重送信しない。
5. 完了・失敗後にfocusを復元する。
6. Tab順が論理的である。

### 7.9 Feasibility/evaluation

1. Required minutes equal scheduled plus unscheduled.
2. Options are deterministic IDs.
3. AI text does not recalculate values.
4. Requirement matrix has no missing or duplicate ID.
5. Replay output redacts prompt/token/API-key-like fields.

## 8. Result classification

各項目を次で分類する。

```text
module implemented
automated verification passed
production connected
browser verified
known failure
not verified
failed
```

一つの`complete`へ丸めない。Issue #21は`known failure`として他のscenario成功と分離する。

## 9. Report format

- branch、HEAD、initial working tree
- PR #5 merge baselineとの差
- targeted test result
- TypeScript result
- build result
- full test result
- production entrypoint inspection
- browser result by scenario
- classification matrix
- Issue #21 reproduction result
- failures with file、test/scenario、expected、actual、stack traceまたは再現手順
- files changed: none
- final `git status -sb`

Do not fix failures in this task. 不具合が見つかった場合は、一つの原因と責務境界を持つ別task候補として報告する。
