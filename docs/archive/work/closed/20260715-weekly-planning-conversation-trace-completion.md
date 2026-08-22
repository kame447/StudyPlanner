# 週間計画 conversation trace completion record

Status: **closed / implementation completed**
Completed: 2026-07-15
Current branch containing the implementation: `main`
Architecture: `docs/architecture/weekly-planning-conversation-trace.md`

## 実装済み

- Firestoreのsession summaryとappend-only entry journal
- `turn`、`internal_event`、`state_snapshot`の有限契約とruntime decoder
- logical conversation identity、request idempotency、sequence順序
- recursive redaction、payload上限、corrupt entryのsafe discard
- trace保存失敗によってplanning処理を失敗させないbest-effort境界
- user ownership拒否と管理者専用viewer
- redacted JSON export
- turn/internal eventは90日、state snapshotは30日の`expireAt`
- preview、approval、fallback、readiness、feasibility、state transitionの相関
- targeted、weeklyPlanning全体、full test、buildの検証

## 実装時の検証

Node 22のGitHub Actionsで次が成功した。

```sh
npm run test:run -- src/features/weeklyPlanning/trace
npm run test:run -- src/features/weeklyPlanning
npm run test:run
npm run build
```

## 未完了の運用・設計判断

次は実装本体の未完了ではなく、別の運用またはprivacy taskとして扱う。

- Firestore TTL policyのproduction有効化
- account deletion時のtrace cascade deletion
- productionでtraceをopt-inにするか
- 発話全文を保存する必要があるか
- user/assistant turn本文へ保存前redactionを適用するか
- 開発環境とproductionで保存方針を分けるか
- 管理者閲覧、保持期間、削除方法をユーザーへどう説明するか
- entry数増加、pagination、archive、schema migration

上記が決まるまで、trace architectureを会話履歴の無断永続化を許可する根拠として扱わない。

## 参照規則

現行schemaと保存境界はarchitectureを正とする。本記録は実装・検証履歴であり、今後のprivacy判断やretention変更を直接指示しない。
