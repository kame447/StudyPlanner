# Stable V5 runtime trial 残課題

Status: active
最終更新: 2026-07-24
Reviewed main baseline: `a669b166db30fa3f355371c089062eb5cf4e3987`

## 目的

2026-07-24のtrace continuity七視点監査で発見した、PR #83の修正範囲を超えるruntime課題を管理する。trace session分裂、30分idle split、controller連番再利用、remote handle再発行、write failure sequence gapは本taskの前提として修正済みとする。

## P1: cross-tab sequence coordination

同一owner・week・conversationを複数tabで同時操作した場合、各tabが同じpersisted application stateまたはtrace cursorを読み、同じrequest、turn、trace sequenceを発行する可能性がある。

要求:

- browser-wideまたはserver-authoritativeな排他境界を持つ。
- request、turn、message、trace entryのsequenceを一transactionで予約する。
- Web Locks未対応環境のfallbackを定義する。
- lock取得不能時に重複IDを発行せずfail closedにする。
- two-tab integration testを追加する。
- remote immutable entry conflictを正常な競合として観測できるようにする。

## P1: dialogue grounding

実トレースでは第二turnで「院試」「ハードウェア」「OSnetwork」を受理しているが、assistantは第一turnと同じ一般質問を返している。

要求:

- accepted fact diffをacknowledgementへ反映する。
- 受理したtask、category、componentを無視して同じ一般文だけを返さない。
- acknowledgementと次の不足質問を分離する。
- multi-turn roleplay fixtureを追加する。
- trace snapshotのaccepted factsとassistant文面のgroundingを評価する。

## P1: final trace delivery durability

application turn commit後のtrace writeはbest-effort side effectである。commit直後にtabまたはbrowserを閉じた場合、会話状態は保存済みでも最後のtrace appendが完了せず、監査ログの末尾だけが欠落する可能性がある。

要求:

- application commitをtrace成功へ同期させず、利用者操作をblockしない。
- unsent metadataとredacted payloadのdurable queue境界を定義する。
- `sendBeacon`、service worker、IndexedDB queue、server-side ingestion queueを比較する。
- reload後のat-least-once deliveryとimmutable entry idempotencyを利用する。
- owner変更、利用停止、削除要求時のqueue破棄を定義する。
- abrupt-close integration testまたはbrowser testを追加する。

## P2: trace source semantics

`responseSource=system`はdeterministic rendererを表しているが、発話理解がAI semantic normalizerを経由した事実を表せない。

要求:

- renderer sourceとsemantic interpretation sourceを別fieldまたはeventへ分離する。
- export schema、admin viewer、evaluation fixtureの互換性を維持する。
- legacy、Stable V5、provider failureを識別する。
- raw provider responseは保存しない。

## P2: explicit reset cleanup

新conversationまたは明示resetではlocal trace cursorを削除するが、保存済みserver handle mappingと過去sessionのstatus更新は別lifecycleである。historical sessionを自動mergeしない一方、不要なlocal mappingを無期限に残さないcleanup契約が必要である。

要求:

- explicit reset時に旧local cursorとserver handle mappingを同じowner scopeで削除する。
- remote sessionを`completed`または`abandoned`へ更新する条件を定義する。
- cleanup failureが新conversation開始を妨げない。
- logout、account deletion、trace consent撤回と同じ削除境界へ接続する。
- stale mapping pruning testを追加する。

## 完了条件

各項目は独立PRに分割できる。実装、focused test、full test、typecheck、build、browserまたはmulti-tab verification、対応MD更新を完了した項目だけclosedへ移す。
