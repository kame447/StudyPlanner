# Stable V5 runtime 残課題

Status: active / semantic handoff partially repaired, cross-cutting work remains
Priority: P1-P2
Created: 2026-07-24
Updated: 2026-07-31
Depends on:
- `20260731-weekly-planning-stable-v5-verification-and-cutover.md`

## 1. 2026-07-31時点の完了範囲

PR #107で次を実装中である。

- renderer文面からquestion codeを逆推定する処理の廃止
- question code、target fact、graph revisionを持つmachine pending question
- short answerのexact target binding
- rendererの`actionId`、`actionKind`、`questionCode`一致検証
- planningWindow omission repair

このPRの検証完了前に上記を完了扱いにしない。

## 2. P1: generic semantic turn delta・coverage

現在のsemantic documentは新規Fact表現が中心で、既存Factへの回答・更新・不確実性解消がquestion code別処理に残る。

要件:

- `newFacts`、`answers`、`corrections`、`uncertainties`を区別するturn delta
- target fact、field、value、source evidenceのtyped contract
- add/supersede/remove/uncertainty resolveのgeneric lifecycle applier
- user evidenceがfact/uncertainty/correctionのいずれかへ対応するcoverage registry
- unsupported inventionとomissionの別diagnostic
- one-shot/multi-turn semantic equivalence test

## 3. P1: cross-tab sequence coordination

- request、turn、message、trace entryの一意なsequence
- browser-wideまたはserver-authoritative reservation
- lock/reservation不能時はfail closed
- cloud session authorityとの二重正本を作らない
- two-tab integration/browser test

## 4. P1: final trace delivery durability

- planning operationをtrace成功へ同期させない
- redacted durable outbox
- immutable entry IDによるat-least-once delivery
- abrupt close、reload、reconnect後の再送
- owner変更、同意撤回、account deletion時のqueue破棄
- duplicate/partial batchの収束

PR #106でrenderer promptのpersistent outbox保持は実装済みだが、tab/browser close時の末尾deliveryは未完了である。

## 5. P2: trace source semantics

- semantic interpretation sourceとrenderer sourceを分離
- model/provider/versionをbounded metadataで保持
- legacy、Stable V5、provider failureを識別
- export/admin/evaluation互換

## 6. P2: explicit reset cleanup

- local cursor、server handle mapping、durable outboxのowner-scope cleanup
- remote sessionのcompleted/abandoned/failed遷移
- logout、consent撤回、account deletionへの接続
- clear conversationではcleanupしない
- cloud session invalidationとの責務分離

## 完了条件

各sectionは独立work unitとして、implementation、focused/full test、typecheck/build、browserまたはmulti-tab verification、trace/export確認を満たした場合だけclosed completion recordへ切り出す。一部完了で本task全体をclosedにしない。