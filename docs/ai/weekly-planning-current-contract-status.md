# weeklyPlanning current contract status

Status: canonical / active status overlay
Updated: 2026-07-31

- Runtime contract: [weekly-planning-stable-v5-runtime-trial-contract.md](weekly-planning-stable-v5-runtime-trial-contract.md)
- Semantic contract: [weekly-planning-current-contract-v5.md](weekly-planning-current-contract-v5.md)
- Roadmap: [strategy/weekly-planning-roadmap.md](strategy/weekly-planning-roadmap.md)
- Active-task inventory: [audits/20260731-weekly-planning-active-task-inventory.md](audits/20260731-weekly-planning-active-task-inventory.md)
- Semantic handoff audit: [audits/20260731-weekly-planning-semantic-state-handoff-seven-audit.md](audits/20260731-weekly-planning-semantic-state-handoff-seven-audit.md)

## 1. AI意味解釈とdeterministic core

- raw user textの初期意味構造化はAI semantic normalizerだけが担当する。
- provider failure、不正JSON、schema/repair failureでparser fallbackへ戻さない。
- deterministic coreはschema、reference、revision、lifecycle、question target、readiness、scheduler、preview、saveを管理する。
- failed/rejected turnで以前のGraphとquestion contextを破壊しない。

PR #107では、直前の質問をrenderer textから逆推定せず、次のmachine stateを正とする。

```text
pendingQuestion:
  actionId
  questionCode
  targetFactId
  graphRevision
```

short answerはこのtargetへだけ適用する。rendererの日本語表現は次turnの状態遷移へ使用しない。

## 2. Semantic/Fact Graph status

実装済み:

- Stable V5 strict document、validator、max one repair
- Fact Graph V5とactive/superseded/removed lifecycle
- staged Graph commit
- generic work item/scheduler input
- planningWindow single-active enforcement

PR #107で実装中・検証待ち:

- `明日`planningWindow omission repair
- machine pending question
- exact target quantity/effort binding
- renderer typed action contract

未実装:

- generic semantic turn delta
- generic lifecycle applier
- evidence coverage registry

## 3. Dialogue renderer contract

rendererへ会話履歴、current user message、Fact Graph summary、current questionを渡す。

renderer responseは次をcore decisionと一致させる。

```text
actionId
actionKind
questionCode
text
```

不一致、文脈にない日時、誤preview件数、未実行の作成・追加・保存claimではdeterministic fallbackへ戻す。ただし自然な説明と言い換えの自由度は維持する。

## 4. Application/session

実装済み:

- conversation/turn/request/revision/week identity
- one active request、stale discard
- modal closeとcancelの分離
- IME guard、focus restoration
- owner/week/conversation-bound local envelope
- Graph/messages/preview/draft復元

未実装:

- cloud authoritative session
- cross-tab/server sequence reservation
- cross-device/offline conflict handling

## 5. Current-time boundary

request時刻より前の同日slot除外は未実装。Stable V5 previewは既定`09:00–22:00`を現在時刻でclipしないため、P0 taskとして残る。

## 6. Preview/approval

preview/approval core idempotencyは実装済み。production Rules/TTL、Emulator、2tab/2端末検証は未完了。

## 7. Quality trace

実装済み:

- same-handle recoveryとserver IDs
- frontend/Worker event catalog
- redaction/HMAC/admin export
- request/entry size batching
- renderer request、prompt context、raw response、fallback、final decision
- persistent outbox/Worker境界の将来field・truncation test

未完了:

- Issue #89 same-conversation production verification
- production secret/TTL/Rules/Worker
- abrupt-close final delivery
- pagination/versioned decoder

## 8. External source / Personalization

External source pure loaderは実装済みだがproduction adapter未接続。Personalization foundationは実装済みだがobservation、aggregate、score、governanceは未実装。

## 9. Active task root

Current execution targetは次の8件だけ。

1. `20260731-weekly-planning-midweek-current-time-start-boundary.md`
2. `20260731-weekly-planning-stable-v5-verification-and-cutover.md`
3. `20260731-weekly-planning-runtime-followups.md`
4. `20260731-weekly-planning-synced-conversation-session-store.md`
5. `20260731-weekly-planning-trace-privacy-and-lifecycle.md`
6. `20260731-weekly-planning-approval-operational-rollout.md`
7. `20260731-weekly-planning-external-source-production-adapter.md`
8. `20260731-weekly-planning-personalization-rollout.md`

旧日付の8件は、未完了条件を再監査したうえで上記current recordsへ置換済みである。完了済みtaskの閉じ忘れは確認されなかった。

## 10. Default cutover gate

次が残る場合、Stable V5をdefaultへ変更しない。

- PR #107 automated verificationがred
- renderer text依存の状態遷移
- generic semantic handoffの重大欠陥
- current-time boundary未実装
- actual AI/browser未実施
- trace split/loss再発
- external source adapter未検証
- migration/rollback未検証
- unresolved blocker/major audit finding

module implemented、runtime connected、automated verified、browser verified、cloud synced、operationally deployed、default enabledを明確に区別する。