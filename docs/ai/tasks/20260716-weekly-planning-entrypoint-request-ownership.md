# 週間計画entrypointのrequest ownershipを統一する

Status: planned
Priority: P1
Requirement IDs: DA-TURN-001
Updated: 2026-07-17
Depends on: `20260714-weekly-planning-dialogue-stack-verification.md`
Post-merge status: `docs/ai/weekly-planning-pr5-post-merge-status.md`

## 1. 背景

PR #5で、会話messages、intake、preview候補をsession stateで所有し、modalをpending中に閉じても完了resultを再表示時に復元する経路が`main`へ入った。

一方、request orchestratorとUI policyのmodule、`App.tsx`、`NaturalLanguageAssistant.tsx`、`QuickEntryModal.tsx`の間で、conversation、turn、request、revision、selected week、reset、explicit cancellation、retryの最終ownerが一つのcontrollerへ整理されているかは未確認である。

旧taskでは`close`、`unmount`、`reset`を同じcancel eventとして扱っていたが、PR #5 current contractとは一致しない。

## 2. current lifecycle contract

```text
modal close / presentation component unmount
  → 表示を閉じる
  → sessionとactive request ownerは維持する
  → 完了resultをsessionへcommitし、reopen時に復元できる

selected week変更 / session reset / explicit cancellation
  → current requestをinvalidateする
  → 旧resultをstate、history、status、previewへ適用しない

revision / request / turn / conversation mismatch
  → StaleAsyncResultとして破棄する
  → fallbackやerror messageへ変換しない

browser reload
  → 未完了network requestは再開しない
  → load時にpending ownershipをsanitizeする
```

presentation componentがunmountしたというReact上の事実だけで、domain sessionをcancelしない。

## 3. Current main verification findings

Current main `2af1a5e`の検証で次を確認した。

- `App.tsx`がPlanningStateとactive Promiseを所有し、request ID、selected week、base revisionを生成する。
- modal closeは表示stateだけを閉じるため、presentation unmountだけではrequestをcancelしない。
- `commit_turn`はassistant message、intake、preview candidatesをatomicにReducerへ渡す。
- Reducerはrequest/week/revision mismatchとpending中のnon-terminal mutationを拒否する。
- storageはmessages、intake、preview、draftを保持し、pending turn/approvalをload時にsanitizeする。
- request envelopeにconversation IDとturn IDがない。
- production UIにexplicit cancellationと履歴だけを消す`clear_conversation`が接続されていない。
- 週間計画textareaにCtrl/Meta+Enter、IME guard、focus restorationがない。
- targeted 423 tests、full 1118 tests、TypeScript、buildはpassed。browser roleplayは未検証。

このtaskでは、既存のclose-resume構造を壊さず、未接続責務だけをcontrollerへ移す。

## 9. 目的

週間計画の一requestに対する所有者をapplication controllerへ一本化し、有効なclose-resume resultを失わず、意味的にinvalidatedされたstale resultと二重送信をproduction entrypointで防止する。

## 4. Entry conditions

- `20260714-weekly-planning-dialogue-stack-verification.md`のentrypoint調査結果を先に確認する。
- PR #5 merge後の`main`を対象にstate ownershipとcallback経路を再調査する。
- Issue #21の日付parser修正とrequest ownership refactorを同じPRへ混ぜない。
- browser close-resume scenarioをcharacterization testとして固定してからownerを移す。

## 5. 対象責務

- conversation IDとsession lifecycle
- turn ID、request ID、input state revision
- selected week変更
- active request中の二重送信
- modal closeとreopen
- presentation component unmount/remount
- session reset
- explicit cancellation
- browser reload後のsanitize
- retry時の新しいrequest identity
- stale resultのstate、history、status、previewへの適用禁止
- request完了時のmessages、intake、preview candidateのatomic commit

## 6. 触らない範囲

- schedulerの配置判断
- AI promptの意味解釈規則
- 漢数字絶対日付parser
- approval persistence方式
- trace privacy方針
- UIデザイン全面変更
- server-side request再開

## 7. 受け入れ条件

### Controller ownership

- production entrypointが一つのcontrollerからrequest envelopeを生成する。
- active requestは一conversationにつき一件である。
- request envelopeはconversation、turn、request、input revision、selected weekを持つ。
- retryは新しいrequest IDとturn IDを持つ。

### Close and resume

- modal closeまたはpresentation component unmountだけではrequestをcancelしない。
- Promise完了後、user発話、assistant応答、intake、preview candidateをsessionへcommitする。
- reopen後にuser発話、assistant応答、preview内容、draft昇格操作を表示する。
- close中の完了resultをStaleAsyncResultまたはerrorへ変換しない。

### Invalidation

- selected week変更、session reset、explicit cancellation後の旧resultを適用しない。
- request、turn、conversation、revision mismatchをstaleとして破棄する。
- stale resultをfallbackやerror messageへ変換しない。
- invalidated requestからpreview、assistant message、statusを追加しない。

### Reload

- 保存sessionのload時に`pendingTurn`と`pendingApproval`を除去する。
- user/assistant messages、入力済み条件、保存済みpreview/draftを保持する。
- reload前の未完了network requestを再開済みと誤表示しない。

### UI policy

- IME中の送信を抑止する。
- Enterは改行、Ctrl/Meta+Enterは送信として一系統で接続する。
- buttonとkeyboard同時発火で二重送信しない。
- 完了または失敗後にfocusを復元する。

### Verification

- unit testでenvelopeとinvalidation contractを固定する。
- integration testでsession commitとstale discardを固定する。
- component testでclose/unmount/remountを実UI操作から確認する。
- browser scenarioでclose-resume、selected week変更、reset、IME、focusを確認する。

## 8. Exit conditions

- module implemented、production connected、automated verified、browser verifiedを別々に記録する。
- App、NaturalLanguageAssistant、QuickEntryModalのどこがrequest lifecycleを所有するか一意に説明できる。
- modal closeとsession cancelが別operationとしてcode、test、docsで一致する。
- 未接続箇所またはbrowser未検証が残る場合はfully completeとしない。
