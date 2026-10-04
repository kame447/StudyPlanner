# 週間計画 approval production rollout

Status: active / source implemented, production operation pending
Priority: P1 operations
Updated: 2026-10-04
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

## Recorded deployment evidence

Firestore Rulesの初回deployment/read-backはPR #236 / #239で完了済み。詳細な証拠は[Issue #51のdeployment checkpoint](https://github.com/kame447/StudyPlanner/issues/51#issuecomment-5456632634)と[成功したworkflow](https://github.com/kame447/StudyPlanner/actions/runs/33202203050)を参照する。merge commitは`b434acb716dd384c1335a1e81aba76d9834ae9a4`で、当時の本番read-backはrepositoryのRulesと一致した。

これは記録済みrevisionの証拠であり、現在の本番全設定・TTL・実端末concurrencyの再検証を意味しない。以降のRules変更は既存WIF deployment workflowと各revisionのread-backで追跡し、初回deploymentを未実装として再開しない。

## Remaining production work

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
