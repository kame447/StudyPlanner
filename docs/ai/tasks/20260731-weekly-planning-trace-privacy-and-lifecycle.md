# 週間計画traceのproduction privacy・lifecycle・scalabilityを完了する

Status: active / core implemented, production operations pending
Priority: P1 operations
Requirement IDs: P7-TRACE-001
Created: 2026-07-16
Updated: 2026-07-31
Tracking: Issue #89

## 実装・自動検証済み

- version付きtrace同意
- HMAC subject tokenとraw UID非保存
- redaction、expireAt、restricted admin API、access audit、account trace delete API
- frontend/Worker共通event catalogとtransport limit
- failed append後のsame handle reuse
- renderer prompt、raw response、fallback、final decisionのturn diagnostic保存
- prompt拡張fieldのoutbox/Worker境界とsize/truncation test

実装済みでも、production secret、Rules、TTL、削除運用、browser確認が未完了のためoperationally deployedではない。

## Production残件

- production HMAC secret ringとrotation手順
- Worker/Firestore Rules deploy revision記録
- session/entry collection groupのTTL enable
- account deletion cascade
- non-reader admin拒否とreader audit
- privacy noticeと実保存fieldの照合
- pagination、stable cursor、bounded query、index
- schemaVersion別decoderとunknown/corrupt entry表現
- privacy/legal review

## Issue #89 verification

main merge/deploy後、同じlogical conversationへ実入力し次を確認する。

```text
session件数 = 1
turnCount > 0
entryCount > 0
renderer promptとsemantic pending-question diagnosticsを再構成可能
reload/retry後もsession件数が増えない
historical empty artifactを標準未export一覧へ表示しない
```

確認前にIssue #89をcloseしない。

## 完了条件

- [ ] production secret/rotationを設定
- [ ] Worker/Rulesをdeployしrevisionを記録
- [ ] TTLをenable
- [ ] account deletion cascadeを確認
- [ ] restricted readとauditを確認
- [ ] pagination/index/versioned decoderを実装
- [ ] privacy/legal review recordを保存
- [ ] focused/full/typecheck/typecheck:build/build/diff checkがgreen
- [ ] browserでconsent、append、export、archive、deleteを確認
- [ ] Issue #89 same-conversation verificationを完了

## 対象外

- cloud conversation session repository
- personalization aggregation
- approval ledger運用
- historical empty sessionの自動merge