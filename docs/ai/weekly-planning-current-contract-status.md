# weeklyPlanning current contract status

Status: canonical / active status overlay
Updated: 2026-07-28
Reviewed branch baseline: `f8e4904dd1038a77df1220363fd35b222bb74bd5`

- Runtime contract: [weekly-planning-stable-v5-runtime-trial-contract.md](weekly-planning-stable-v5-runtime-trial-contract.md)
- Semantic contract: [weekly-planning-current-contract-v5.md](weekly-planning-current-contract-v5.md)
- Roadmap: [strategy/weekly-planning-roadmap.md](strategy/weekly-planning-roadmap.md)
- Active-task inventory: [audits/20260728-weekly-planning-active-task-inventory.md](audits/20260728-weekly-planning-active-task-inventory.md)
- Current trace audit: [audits/20260727-stable-v5-trace-empty-session-seven-audit.md](audits/20260727-stable-v5-trace-empty-session-seven-audit.md)

## 1. 優先順位

```text
runtime/current contract
→ current status
→ roadmap
→ active task root
→ architecture/specの非競合部分
→ closed/superseded/historical records
```

queueはroadmapとactive-task inventoryだけを正とする。過去PR本文、closed task、superseded taskに残るbranch名や未完了記述をcurrent statusとして使用しない。

## 2. AI意味解釈とdeterministic core

- raw user textの初期意味構造化はAI semantic normalizerだけが担当する。
- provider failure、不正JSON、schema mismatch、repair failureでrules/parser fallbackへ戻さない。
- AIはFact ID、revision、missing priority、question selection、readiness、scheduler、preview、approval、saveを決定しない。
- deterministic coreはschema、reference、revision、lifecycle、conflict、readiness、feasibility、placement、save boundaryを管理する。
- failed/rejected turnで以前のGraphとquestion contextを破壊しない。

Stable V5 direct runtimeはfeature flag付きでexisting UIへ接続済み。defaultはlegacyであり、cutover gate完了前に変更しない。

## 3. Application sessionとrequest ownership

実装済み:

- conversation/turn/request/revision/week identity
- one active request per conversation
- stale result discard
- modal close/unmountとsession cancellationの分離
- selected week/reset/cancel後のold result拒否
- Enter改行、Ctrl/Meta+Enter送信、IME guard、focus restoration
- application lifecycle、turn application、turn side effect分離

```text
modal close / presentation unmount
→ sessionとactive requestを維持
→ ownership一致時だけresultをcommit

week change / explicit reset / cancel / owner change
→ old resultを現在stateへ適用しない
```

`clear conversation`は表示messagesだけを消し、conversation ID、request sequence、Fact Graph、preview、draft、trace continuityを維持する。

`reset session`はmessages、intake、preview、draft、pending ownership、conversation identity、Fact Graph、persisted Stable V5 sessionを初期化し、新conversationを開始する。

## 4. Stable V5 local persistence

保存scope:

```text
owner ID + week scope
```

保存済み:

- conversation ID
- messages
- compatibility intake state
- Fact Graph V5
- PlanningState revision
- preview candidates
- draft blocks
- savedAt/schema version

保存禁止:

- active Promise
- pending turn/approval
- session-local proposal record
- raw credential/provider response

owner/week/conversation/revision mismatch、unknown version、corrupt payloadはfail closedで破棄する。

これはsame browser profileのlocal persistenceであり、cloud/cross-device syncではない。cloud repositoryはactive taskとして未実装。

## 5. Planning rangeとcurrent-time boundary

week scopeとplacement horizonを同一視しない。

- explicit date/range/weekdayはprofileより優先
- account week-start settingは「今週」「来週」の解釈に使用
- task date eligibilityはStable V5 scheduler inputへ接続済み
- non-consecutive date、weekday set、exact exclusionを保持

未実装:

- request時刻より前の同日slot除外
- request-scoped clock snapshot
- explicit past startのblocking clarification

現在のStable V5 preview schedulerはdefault `09:00–22:00` windowを使い、当日の現在時刻でclipしない。これはP0 hard-safety taskである。

## 6. Previewとapproval

- explicit create authorizationとreadiness通過後だけpreviewを生成
- partial placementは禁止
- insufficient capacityでは候補全体を破棄
- previewはowner、conversation、Graph revision、source factsへ拘束
- stale/pending/owner mismatchをsave前に拒否
- approvalはdedicated save boundary、deterministic Plan ID、server transaction idempotencyを使用

Implementation/automated verificationは完了。production Rules/TTL、Emulator、2tab/2device verificationは未完了。

## 7. Quality trace continuity

Current intended invariant:

```text
same owner + same logical conversation + no explicit reset
→ same local trace session identity
→ same server-issued handle
→ monotonic entry/turn sequence
```

PR #83でreload、idle、repository recreation時のcontinuityを実装したが、PR #86のfull debug trace追加後、frontend/Worker/transport/privacy contract driftにより`session/start`だけ成功してappendが拒否される経路が発生した。

Current branchで次を修正済み:

- shared event catalog/limits
- Stable V5 debug eventのWorker受理
- document/string/token-redaction-safe chunk encoding
- entry/byte batching
- zero-count identity先行保存
- failed append後のsame handle reuse
- empty artifactの未export除外

First verification:

```text
focused trace: 9 files / 65 tests passed
trace full: 1 failed / 78 passed
npm run typecheck: 1 error
npm run typecheck:build: passed
npm run build: passed
```

失敗した旧test decoderとunion fixtureは修正済み。再実行前なのでautomated verifiedとは記載しない。main deploy後にadmin viewerでsame conversation 1 sessionかつturn/entry > 0を確認するまでIssue #89をcloseしない。

Historical empty sessionsは自動mergeしない。標準未export一覧には表示しない。

## 8. Trace privacy/operations

実装済み:

- version付きconsent
- HMAC pseudonymous subject
- redaction
- server-authoritative IDs
- restricted admin endpoints/audit
- account trace delete API
- expireAt

Production未完了:

- secret ring registration/rotation
- Worker/Rules deploy
- Firestore TTL policy enable
- deletion operation verification
- admin browser verification
- pagination/index/versioned decoder
- privacy/legal review

## 9. External source

Pure loaderは実装済み:

- atomic `success(events) | failure(reason)`
- no partial result
- bounded retry
- failureをempty successとして扱わない
- owner/shape validation

未接続:

- production calendar adapter
- pagination/auth refresh/metrics
- browser verification

## 10. Cloud sessionとcross-tab

未実装:

- cloud authoritative conversation/Graph revision
- cross-device restoration
- offline reconciliation
- local migration
- 2tab/2device conflict handling
- browser/server sequence reservation

local persistenceとtrace continuityをcloud sync完了へ読み替えない。

## 11. Personalization

Foundation実装済み:

- account-linked profile schema
- week-start setting
- origin/confidence/scope/expiry
- profile v2 bounded placement parameter schema

未実装:

- planning/outcome observation
- reset validity propagation
- time-decayed aggregate
- uncertainty/effective sample
- personalized safe-candidate ordering
- production consent/TTL/account deletion/audit

旧5分割taskは一つのrollout taskへ統合した。

## 12. Active task root

Current execution targetは次の9件だけ。

1. `20260727-weekly-planning-trace-empty-session-recovery.md`
2. `20260716-weekly-planning-midweek-current-time-start-boundary.md`
3. `20260728-weekly-planning-stable-v5-verification-and-cutover.md`
4. `20260724-weekly-planning-runtime-followups.md`
5. `20260716-weekly-planning-synced-conversation-session-store.md`
6. `20260716-weekly-planning-trace-privacy-and-lifecycle.md`
7. `20260718-weekly-planning-approval-operational-rollout.md`
8. `20260728-weekly-planning-external-source-production-adapter.md`
9. `20260728-weekly-planning-personalization-rollout.md`

実装完了済みtaskはclosedへ、別trackerへ統合した未完了taskはsupersededへ移動済み。

## 13. Default cutover gate

次が残る場合、Stable V5をdefaultへ変更しない。

- automated verification failure
- current-time boundary未実装
- actual AI real-eval未実施
- browser roleplay未実施
- trace append/split issue
- external source adapter未検証
- migration/rollback未検証
- unresolved blocker/major audit finding

module implemented、runtime connected、automated verified、browser verified、cloud synced、operationally deployed、default enabledを明確に区別する。