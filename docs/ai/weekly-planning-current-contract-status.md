# weeklyPlanning current contract status

Status: canonical / active status overlay
Updated: 2026-07-27
Reviewed main baseline: `14e2184856fdbdb1f6513735e9eae3efb45c9822`

- Runtime and local persistence: [weekly-planning-stable-v5-runtime-trial-contract.md](weekly-planning-stable-v5-runtime-trial-contract.md)
- Semantic V5 contract: [weekly-planning-current-contract-v5.md](weekly-planning-current-contract-v5.md)
- Roadmap: [strategy/weekly-planning-roadmap.md](strategy/weekly-planning-roadmap.md)
- Trace continuity audit: [audits/20260724-stable-v5-trace-continuity/final-overseer.md](audits/20260724-stable-v5-trace-continuity/final-overseer.md)
- PR #75 completion: [tasks/closed/20260722-weekly-planning-ai-only-semantic-boundary-and-seven-audit.md](tasks/closed/20260722-weekly-planning-ai-only-semantic-boundary-and-seven-audit.md)
- Cloud session store task: [tasks/20260716-weekly-planning-synced-conversation-session-store.md](tasks/20260716-weekly-planning-synced-conversation-session-store.md)
- Approval rollout: [tasks/20260718-weekly-planning-approval-operational-rollout.md](tasks/20260718-weekly-planning-approval-operational-rollout.md)

## 1. 役割と優先順位

この文書は、semantic V5以外のrequest ownership、session、preview、approval、trace、personalization、運用statusを統一する。Stable V5の接続状態とlocal persistenceはruntime trial contractを優先する。

```text
runtime trial contract
→ semantic V5 current contract
→ current implementation status
→ roadmap / current queue
→ active tasks
→ spec / architectureの非競合部分
→ historical / closed / superseded records
```

queueはroadmapだけを正とする。過去PR本文やclosed taskに残るbranch、head、Draft、queuedをcurrent queueとして使用しない。

## 2. AI意味解釈と決定論的core

自然言語の初期意味解釈はAI interpreterだけが担当する。production経路はAI typed semantic outputをclosed schema、runtime validator、reference resolver、canonicalizerへ渡す。provider例外、不正JSON、schema不一致、空応答、候補全拒否、repair失敗でrules parserまたはlegacy parserへfallbackしない。

AIはstate、missing、質問、readiness、preview可否、scheduler、approval、saveを直接決定しない。deterministic coreはshape、enum、値域、公開参照、confirmed fact、revision、重複、競合、feasibilityを検証する。failedまたはrejected turnでは以前の意味状態と質問文脈を維持し、preview、draft candidate、assumption artifactを生成しない。

Stable V5 direct runtimeはPR #77とPR #79を経て`main`へ統合済みである。defaultは環境変数で変更されない限りlegacyであり、利用者または開発者が明示的にStable V5へ切り替える。

## 3. planning rangeと週の始まり

初回だけ月曜日始まりまたは日曜日始まりを確認し、account-linked personalization profileへ保存する。「今週」「来週」は保存設定に従う。発話中の具体的な開始日、終了日、曜日範囲はprofileより優先する。profile未設定、破損、競合時だけ明示修復へ入る。

週sessionのscopeである`weekStartDate`と、実際の配置対象であるplanning horizonを同一視しない。

## 4. application sessionと非同期lifecycle

PlanningStateはmessages、compatibility intake state、preview、draft、pending ownershipを所有する。conversation ID、turn ID、request ID、week、base revisionの不一致はstale resultとして拒否する。pending turnまたはapproval中の不正mutationを拒否する。

```text
modal close / component unmount
→ application sessionを維持する
→ 完了resultはownership一致時だけcommitする

week変更 / explicit reset / cancellation / owner変更
→ 旧resultを現在stateへ適用しない

browser reload中の未完了request
→ network requestは再開しない
→ pending ownershipを保存しない
```

`clear conversation`、`reset session`、runtime mode change、account profile resetは別操作として扱う。

`clear conversation`は画面に表示されるuser/assistant message履歴と最後のassistant表示だけを消す。次は維持する。

```text
conversation ID
request sequence
compatibility intake state
Stable V5 Fact Graph
preview candidates
draft blocks
approvalに関する作業状態
planning mode
persisted Stable V5 session
trace continuity
```

`clear conversation`から`reset session`を呼ばない。Fact Graph、runtime session、persisted session、trace sessionを削除しない。同じconversationを継続し、次のturnは消去前より大きいrequest sequenceを使用する。

`reset session`は「最初からやり直す」操作である。messages、intake、preview、draft、pending approval、request sequence、conversation identity、Fact Graph、persisted Stable V5 sessionを初期化し、新しいconversationとして開始する。

## 5. Stable V5 local persistence

2026-07-23以後、Stable V5のconversationとFact Graphを同時にlocalStorageへ保存する。保存scopeは`owner ID + week start date`である。

保存対象:

```text
version
owner ID
week start date
conversation ID
Fact Graph V5
messages
compatibility intake state
preview candidates
draft blocks
savedAt
```

保存禁止:

```text
pendingTurn
pendingApproval
session-local proposal record
未完了request ownership
```

owner、week、conversation、Graph source、draft metadata、preview metadata、size、timestamp、shapeをclosed validationする。cross-user payload、Graphとconversationの不一致、破損JSON、未知versionはfail closedで破棄する。

ページ再読込後はconversation、Fact Graph、preview、draftを同じrevision境界で復元する。これは同一browser profile内のlocal persistenceであり、別端末cloud syncではない。

## 6. quality trace continuity

quality traceはapplicationのlogical conversationと一対一で継続する。

```text
trace continuity scope = user ID + conversation ID
```

同じconversationでは、reload、runtime module再初期化、remote repository再生成、30分を超えるidleによって別physical sessionを作らない。physical session ID、sequence、turn index、bounded request dedupe、server-issued handleを復元する。新conversation、explicit reset、owner変更、week scope変更だけが新sessionを生成する。

server-issued handleはraw account identityではなく、server-side HMACで決定されたstructural IDである。clientはhandleをowner-scoped local mappingへ保存するが、owner認証の正本にはしない。append APIのFirebase認証、server-issued session、owner token照合がauthoritativeである。

serverがhandleの不存在、ownership conflict、legacy read-only、conversation conflictを明示した場合だけhandleを再発行する。一時的network failureまたはresponse lossでは同じcanonical payloadを再送し、不要なsession rotationを行わない。

過去に分割済みのlogsは自動mergeしない。誤結合を避けるためhistorical recordとして保持する。turn commit直後のtrace書込みはbest effortであり、abrupt page close時の最終turn durabilityは後続課題である。

## 7. previewとapproval

previewはexplicit authorizationとreadiness gate通過後だけ生成する。assistantが提案しただけでは生成しない。previewはowner、conversation、Graph revision、source factsへ拘束する。stale preview、pending assumption preview、owner mismatchを保存前に拒否する。

承認は専用save boundaryを使用し、selectedDate、view、editor等の手動編集UI状態を変更しない。repositoryが返した実Plan IDをoperationへ記録し、server transactionとdeterministic Plan IDをmulti-client idempotencyの正本とする。

本番Firestore rules、TTL、Emulator、2tab・2端末確認が完了するまでapprovalをoperationally deployedと扱わない。

## 8. user-boundary storage

local stateはversion、owner、payloadを同一envelopeとして保存する。owner不一致、cross-user draft、破損payloadを破棄する。userまたはweek scope切替renderで旧stateを新keyへ保存しない。approval ledgerもuser別に分離する。

versioned payloadのdecodeは純粋処理として行い、検証のためにlive localStorage keyへpayloadを一時書込みしてはならない。保存領域への書込みは明示的なsaveまたはlegacy migrationのcommit境界だけで行う。

Stable V5 trace continuity、application session、approval ledger、personalization profile、quality trace server repositoryは別schema、別key、別責務として管理する。

## 9. cloud synced conversation session

次は未実装である。

```text
端末Aから端末Bへのsession復元
cloud authoritative revision
multi-client conflict resolution
offline cache reconciliation
localStorage一度限りmigration
cloud retention / account deletion cascade
```

active taskは`20260716-weekly-planning-synced-conversation-session-store.md`である。local persistenceとtrace continuityの完了を、このtaskの完了へ読み替えない。

## 10. personalization

account-linked profile foundationは実装済みである。week start、fact origin、confidence、scope、confirmedAt、expiresAt、settings変更、profile resetを持つ。一時的な相談条件をrecurring profileへ自動昇格しない。

未完了は、current-time boundary、session同期、相談resetの派生観測無効化、plan/actual observation、時間減衰、不確実性、placement score、同意・TTL・削除・監査・privacy reviewである。

## 11. privacyと運用

raw Firebase UID、email、表示名をserver trace documentへ保存しない。server-side HMAC subject tokenを使用し、本文とsnapshotはredactionを通す。限定閲覧、access audit、retention、account deletionを別運用gateとして扱う。

code implementation、production connection、automated verification、browser verification、cloud sync、operational deploymentを同一視しない。

## 12. current implementation status

PR #83は`main`へmerge済みである。trace continuity、controller sequence continuity、remote server handle continuityの実装はmain baseline `14e2184856fdbdb1f6513735e9eae3efb45c9822`へ含まれる。

Draft PR #86、branch `agent/studyplanner-refactor`で次を変更中である。

```text
clear conversationとreset sessionの境界修正
clear後のstructured planning state・preview・draft・identity維持テスト
owner-bound storage decodeの純粋化
storage read時の無副作用テスト
session復元・scope同期・明示reset・runtime切替resetのapplication lifecycle分離
turn実行・Graph finalize/discard・commit/failure traceのapplication service分離
session lifecycle、turn application、turn side effectのfocused unit test
```

`useWeeklyPlanningApplication`は状態とUI向け操作のcomposition rootに限定し、AI semantic executor、Fact Graph lifecycle、trace repository、Stable V5 storageの実装詳細を直接所有しない。AI semantic normalizerとdeterministic coreの責務境界は変更していない。

PR #86のfocused verificationには少なくとも次を含める。

```text
src/features/weeklyPlanning/__tests__/weeklyPlanningConversationClear.integration.test.ts
src/features/weeklyPlanning/application/weeklyPlanningSessionLifecycle.test.ts
src/features/weeklyPlanning/application/weeklyPlanningTurnApplication.test.ts
src/features/weeklyPlanning/application/weeklyPlanningTurnSideEffects.test.ts
src/features/weeklyPlanning/weeklyPlanningOwnedStorage.test.ts
src/features/weeklyPlanning/weeklyPlanningStorageDecoder.test.ts
src/features/weeklyPlanning/weeklyPlanningTurnController.test.ts
```

最新確認head `368ec5116a0586dd22574294c424a0edcddf5366`のGitHub Actions run `30227401870`も`verify` jobを生成したが、step 0件・logsなしでrunner起動前に失敗した。code test failureとは判定しない。focused test、full Vitest、typecheck、buildは未確認であり、PR #86はDraftのまま維持する。検証未実施の状態をtest成功またはrefactor完了と記録しない。

## 13. Task operation

`tasks/`直下には未完了taskだけを置く。完了範囲は`tasks/closed/`、契約変更で不要になったtaskは`tasks/superseded/`へ移す。current queueはroadmapだけを正とし、PR merge後はbaseline、contract、roadmap、task placementを同期する。
