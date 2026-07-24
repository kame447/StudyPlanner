# 週間計画 Stable V5 semantic schema統合計画

Status: canonical migration plan / direct runtime integration complete / cutover remaining
最終更新: 2026-07-24
Reviewed main baseline: `a669b166db30fa3f355371c089062eb5cf4e3987`

- [Runtime trial contract](../weekly-planning-stable-v5-runtime-trial-contract.md)
- [Current contract](../weekly-planning-current-contract-v5.md)
- [Implementation status](weekly-planning-semantic-stable-v5-implementation-status.md)
- [V5 roadmap](weekly-planning-semantic-v5-roadmap.md)
- [Schema registry](../../architecture/weekly-planning-semantic-schema-registry.md)

この文書はAlpha 1 / Alpha 2からdirect Stable V5へ移行する手順と残りgateを定める。Stable V5 direct schema、validator、canonicalizer、Fact Graph、resolver、scheduler、dialogue、preview、browser persistenceはfeature-flagged runtimeとしてmainへ接続済みである。default cutover、server Graph persistence、旧state migration、legacy削除は未完了である。

## 1. 完了した物理統合

Stable識別子は次で確定した。

```text
WeeklyPlanningSemanticDocumentV5
WeeklyPlanningFactGraphV5
weekly-planning-semantic-v5
weekly_planning_semantic_document_v5
weekly-planning-fact-graph-v5
```

Stable V5はAlpha response schema clone、Alpha validator projection、V1/V2 Fact Graph型継承、V1 canonicalizer projection、provider failure時parser fallbackへ依存しない。Alpha世代はlegacy evaluation、fixture、過去report互換のため残す。

## 2. 現在のruntime generation

```text
raw user text
→ Stable V5 semantic normalizer
→ strict direct validator
→ direct canonicalizer / lifecycle
→ Fact Graph V5
→ active read view
→ generic scheduler input
→ deterministic readiness / dialogue
→ deterministic preview scheduler
→ approval / save
```

AIはsemantic documentだけを生成する。formal ID、revision、target binding、readiness、question、placement、preview、approval、saveはdeterministic coreが担当する。同一turnでlegacy command resultとStable fact resultをmergeしない。runtime mode切替時はconversation generationを分離する。

## 3. canonical transaction

一turnのcanonicalizationはatomicとする。

```text
expected revisionを確認
duplicate turnを拒否
fact ID collisionを拒否
validation失敗時にGraph revisionを進めない
correction / decision / lifecycle更新を一transactionで適用
executor結果をrequest単位にstage
PlanningState commit受理後だけGraph finalize
stale / cancel / commit rejection / failure時はstage破棄
```

## 4. browser persistence

Stable V5はowner・week・conversationに拘束したlocalStorage envelopeへconversation ID、completed PlanningState、Fact Graph V5、preview candidates、draft blocks、savedAtを保存する。

pending turn / approval中は保存しない。owner、week、conversation、Graph source、preview freshness、schema、sizeのいずれかが不正なら部分復元せず全体を破棄する。

この保存は同一browser内だけである。server Graph repository、cross-device continuity、旧state migrationの代替ではない。

## 5. conversationとtrace migration

conversation IDを復元した場合、controllerは保存済みmessage IDとPlanningState revisionからsequenceの単調下限を再構成する。memory counterを0へ戻して`turn:1`または`request:1`を再発行しない。`clear_conversation`でmessagesが空になっても過去request IDへ戻らない。

traceは内容を含まないcursorへlocal trace session ID、next sequence、next turn index、recent request ID、last activityを保存する。repository append成功後だけcursorを更新する。physical traceのscopeは`owner ID + logical conversation ID`であり、30分を超えるidle、page reload、module再生成をsession終了条件にしない。

remote repositoryはserver-issued handleをowner・local sessionへ拘束して保存する。repository再生成後も同じhandleを使用し、30日secret epoch境界で不要なserver session再発行を行わない。serverがsession不存在、ownership conflict、legacy read-only、conversation conflictを明示した場合だけhandleを再発行する。一時的network failureでは同じcanonical payloadを再送する。

server側の認証、subject token、immutable entry、retention、admin audit契約は変更しない。stored handleをowner証明として扱わない。過去に既に分割されたtrace documentは誤結合を避けるため自動mergeしない。

## 6. old persisted state migration

未実装の本番migrationは次のdecoder境界を持つ。

```text
read old envelope
→ validate owner and stored version
→ select deterministic decoder
→ convert confirmed typed state to Stable V5 migration input
→ create Fact Graph V5 with migration metadata
→ validate graph
→ persist new envelope atomically
```

raw conversation本文をAIへ再入力してSemanticDocumentを再生成してはならない。旧stateの確定済みtyped dataだけを決定論的に変換し、根拠不足はunknownまたはunresolvedとして保持する。

migration metadataは少なくとも次を持つ。

```text
sourceStateVersion
sourceSchemaVersion
sourceFactGraphVersion
migrationVersion
migratedAt
ownerId
```

migrationはidempotentにする。途中失敗時は旧envelopeを保持し、versionだけを書き換えない。

## 7. shadowとreal-eval

Stable V5専用real-eval harnessとread-only shadow evaluator moduleは実装済みである。production invocationは未接続である。

reportへsemanticSchemaVersion、jsonSchemaName、factGraphVersion、normalizerBuildVersion、validatorVersion、canonicalizerVersion、outcome、attemptCount、repairAttempted、latencyMs、validationErrorCodes、canonicalizationOutcomeを記録する。raw response、raw conversation本文、semantic本文、external予定本文を保存しない。

production shadowはfull automated verificationと実AI real-eval後に限る。shadowはPlanningState、Graph、preview、repository、schedulerを変更しない。

## 8. rollback

runtime trial中はmodeをlegacyへ戻せる。ただしStable V5 conversationとlegacy conversationを同じgenerationとして継続しない。切替時はStable V5 browser envelopeとruntime Graphを初期化する。

default cutover後にStable Graphをserver保存したsessionは旧executorへ無条件に戻さない。rollbackはsession generation単位で行い、Stable Graphを旧形式へdowngrade保存しない。

## 9. 残りgate

```text
focused trace continuity tests
→ full Vitest / typecheck / production build
→ branch previewでreload・idle・clear後再送を確認
→ admin exportで同一session継続を確認
→ Stable V5 actual AI real-eval
→ branch preview full roleplay
→ read-only production shadow
→ old state migration decoder / dry-run
→ server / cross-device Graph persistence design
→ cutover rehearsal / rollback verification
→ default cutover decision
→ rollback observation
→ legacy runtime deletion
```

## 10. merge禁止条件

次のいずれかが残る変更をdefault cutoverへ採用しない。

```text
AIがinternal command、missing、readiness、preview、scheduler、saveを決める
raw text parserまたはfallbackが後段へ復活する
componentとworkloadが配列位置で対応する
non-consecutive datesが連続rangeへ潰れる
external event本文をAIが生成する
GraphとPlanningStateが別々にcommitされる
stale previewまたはowner mismatchを承認できる
conversation復元後にturn/request/message IDを再利用する
clear後のreloadでrequest IDを再利用する
同じconversationのtraceがreload、idle、repository再生成で分裂する
append failureがsequence gapを作る
test、typecheck、build、real-eval、browser roleplay、七視点監査の結果が未記録である
```

## 11. 残課題の責務分離

- cross-tab同時実行のsequence reservationはbrowser coordination taskで扱う。
- server/cross-device Graph persistenceはrepository migration taskで扱う。
- abrupt page close時の最終trace durabilityはtrace delivery taskで扱う。
- `responseSource`とsemantic interpretation sourceの分離はtrace schema taskで扱う。
- accepted fact acknowledgement不足はdialogue grounding taskで扱う。

現行trace continuity監査は[20260724-stable-v5-trace-continuity](../audits/20260724-stable-v5-trace-continuity/final-overseer.md)を参照する。
