# Stable V5 runtime trial 残課題

Status: active
最終更新: 2026-07-24

## 目的

2026-07-24のtrace continuity七視点監査で発見した、今回の修正範囲を超えるruntime課題を管理する。trace session分裂、controller連番再利用、write failure sequence gapは本taskの前提として修正済みとする。

## P1: cross-tab sequence coordination

同一owner・week・conversationを複数tabで同時操作した場合、各tabが同じpersisted cursorを読み、同じrequest / turn / trace sequenceを発行する可能性がある。

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
- 受理したtask/category/componentを無視して同じ一般文だけを返さない。
- acknowledgementと次の不足質問を分離する。
- multi-turn roleplay fixtureを追加する。
- trace snapshotのaccepted factsとassistant文面のgroundingを評価する。

## P2: trace source semantics

`responseSource=system`はdeterministic rendererを表しているが、発話理解がAI semantic normalizerを経由した事実を表せない。

要求:

- renderer sourceとsemantic interpretation sourceを別fieldまたはeventへ分離する。
- export schema、admin viewer、evaluation fixtureの互換性を維持する。
- legacy / Stable V5 / provider failureを識別する。
- raw provider responseは保存しない。

## P2: expired trace session finalization

persisted cursorがidle timeoutを超えた状態で再開された場合、clientは新sessionを開始する。module memoryが残っている場合は旧sessionを`abandoned`へ更新するが、memoryが失われた後にexpired cursorだけを読む経路ではremote session finalizationがbest effortでない。

要求:

- expired cursorから旧sessionを安全に`abandoned`へ更新する。
- owner / server-issued IDを再検証する。
- finalization失敗が新conversation turnを妨げない。
- stale cursorを必ず削除する。

## 完了条件

各項目は独立PRに分割できる。実装、focused test、full test、typecheck、build、browserまたはmulti-tab verification、対応MD更新を完了した項目だけclosedへ移す。
