# 週間計画 approval production rollout

Status: active / source implemented, production operation pending
Priority: P1 operations
Updated: 2026-08-22
Tracking: Issue #51

## Implemented foundation

- approval 専用 save boundary
- deterministic Plan ID
- server transaction / idempotency foundation
- operation / item ledger
- partial failure recovery
- owner / session / preview revision binding
- restored draft approval lifecycle
- local owner-bound ledger と save side-effect isolation

## Remaining production work

- Firestore Rules deploy revision の記録
- operation / item TTL
- Emulator rules / transaction concurrency test
- 2 tab / 2 device simultaneous approval
- response loss / retry / partial failure / finalize failure / reload
- local cache loss 後の retry convergence
- retention / account deletion orphan handling

## Definition of done

- 同一 preview item が複数 client から承認されても duplicate Plan を作らない
- retry は同一 operation / Plan identity へ収束する
- failed / missing / stale / owner mismatch は fail closed
- production Rules / TTL / concurrency evidence を残す
- focused / full / typecheck / build / browser verification が relevant scope で green

client-first architecture の保存責務を変更する場合は Issue #164 と整合させ、別の approval authority を作らない。
