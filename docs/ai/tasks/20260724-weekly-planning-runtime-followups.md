# Stable V5 runtime 残課題

Status: active / five independent work units
Priority: P1-P2
Updated: 2026-07-28

Depends on:
- current trace blocker: `20260727-weekly-planning-trace-empty-session-recovery.md`
- adoption gates: `20260728-weekly-planning-stable-v5-verification-and-cutover.md`

## 1. このtaskに含めるもの

Stable V5のfeature-flagged runtime接続、local persistence、request ownership、basic trace continuityより後に残るcross-cutting workだけを管理する。

次は別taskで扱う。

- current-time placement boundary
- cloud conversation/Graph repository
- trace production operations/pagination
- approval production rollout
- personalization learning pipeline
- external source production adapter

## 2. P1: cross-tab sequence coordination

同一owner・week・conversationを複数tabで同時操作すると、両tabが同じpersisted revisionを読み、同じrequest/turn/message/trace sequenceを発行し得る。

要件:

- browser-wideまたはserver-authoritative reservation
- request、turn、message、trace entryの一意なsequence
- Web Locks未対応時のfallback
- lock/reservation不能時はduplicate IDを発行せずfail closed
- two-tab integration/browser test
- immutable entry conflictを観測可能な競合として分類
- cloud session repository導入時に二重authorityを作らない

## 3. P1: accepted fact dialogue grounding

実トレースで第二turnのtask/category/componentを受理しても、assistantが第一turnと同じ一般質問だけを返す場合がある。

要件:

- accepted fact diffをacknowledgementへ反映
- 受理済みtask/component/workloadを無視しない
- acknowledgementと次の不足質問を分離
- 同じmissing targetを無変化で再質問する場合は理由を持つ
- graph diff、question plan、assistant文面を同じfixtureで比較
- generic taskとexam-specific wordingを混同しない

## 4. P1: final trace delivery durability

application turn commit直後のtrace appendはbest effortであり、tab/browser closeで末尾だけ欠落し得る。

要件:

- planning operationをtrace成功へ同期させない
- redacted payloadのdurable outbox
- immutable entry IDによるat-least-once delivery
- IndexedDB、service worker、sendBeacon、server ingestion queueを比較
- reload/reconnect後の再送
- owner変更、consent撤回、account deletion時のqueue破棄
- abrupt-close browser test
- duplicate/partial batch再送の収束

## 5. P2: trace source semantics

`responseSource=system`はrenderer sourceを示すが、AI semantic normalizerを経由した事実を表せない。

要件:

- semantic interpretation sourceとrenderer sourceを分離
- model/provider/versionはbounded metadataで保持
- legacy、Stable V5、provider failureを識別
- export/admin/evaluation fixture互換
- raw provider responseを通常trace metadataへ保存しない
- full debug traceと通常quality eventを混同しない

## 6. P2: explicit reset cleanup

新conversationまたはexplicit resetではapplication cursorを消すが、server handle mapping、remote session status、durable outboxは別lifecycleである。

要件:

- old local cursor/handle mapping/outboxを同じowner scopeでcleanup
- remote sessionを`completed | abandoned | failed`へ遷移させる条件
- cleanup failureが新conversation開始を妨げない
- logout、consent撤回、account deletionへ接続
- stale mapping pruning
- clear conversationではcleanupしない
- resetとcloud session invalidationの責務を分離

## 7. Work unit完了条件

各sectionは独立PRにできる。sectionごとに次を満たした時だけ完了記録へ分離する。

- implementation
- focused test
- related full suite
- typecheck/typecheck:build/build/diff check
- browserまたはmulti-tab verification
- trace/admin export確認
- canonical MD同期

一部sectionが完了しても本task全体をclosedにしない。完了sectionはclosed completion recordへ切り出し、未完了sectionだけ本taskへ残す。