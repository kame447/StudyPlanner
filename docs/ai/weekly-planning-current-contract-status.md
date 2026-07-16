# weeklyPlanning current contract status

Status: canonical / active status overlay
Updated: 2026-07-16

## 1. 役割

この文書は、product spec、dialogue architecture、roleplay test planに残る古い実装status、queue、未決定contractの読み方を統一する。product behaviorを新しく決定する文書ではない。

優先順位は次のとおりである。

```text
確定済みproduct decision
→ current implementation facts
→ roadmap Decision gates
→ active architecture/spec/testの未競合部分
→ historical/closed/superseded records
```

queueはroadmapだけを正とする。spec、architecture、roleplay内の古いqueue、branch名、`queued` statusはcurrent queueとして使用しない。

## 2. AIとdeterministic parser

2026-07-16時点の`main`は、legacy fallbackを含まないdeterministic baselineを先に適用し、AI commandを補完的に適用する。provider例外時だけlegacy fallbackを含むrules経路へ切り替える。

一方、spec、dialogue architecture、roleplay、Codex guideには、通常provider経路でAI/rulesのsemantic resultをmergeしないという旧contractが残る。

最終contractは未決定である。決定までは次を守る。

- 現行runtimeを旧no-merge記述だけを根拠に変更しない。
- baseline方式を最終product contractとして確定したとも扱わない。
- 変更taskはroadmap Decision gate 4.1の決定後に、spec、architecture、roleplay、prompt、testを同時更新する。

## 3. 「来週」の意味論

次の二契約は未決定である。

- selected dateから翌週月曜〜日曜へ一意解決し、開始日を再質問しない
- `来週`scopeを保持し、必要に応じて開始日を確認する

2026-07-16時点の実装はpending planning rangeを保持する。roleplay内の「必ず月曜〜日曜へ即時確定」は、Decision gate 4.2が確定するまでcurrent acceptance criteriaとして強制しない。

## 4. conversation trace privacy

product decisionは2026-07-16に確定した。実装契約は`docs/ai/tasks/20260716-weekly-planning-trace-privacy-and-lifecycle.md`を正とする。

- 毎conversationではなく、初回利用時の利用規約・privacy noticeで目的、収集範囲、保存期間、削除方法を説明する。
- raw Firebase UID、メール、表示名をtraceへ保存しない。
- server-side HMACの期間限定subject tokenを使い、30日単位でrotationする。
- 暗号化は安全管理措置であり、匿名化の代替として扱わない。
- 全sessionではstructured metadataを保存し、本文はerror、fallback、明示的修復、低confidence等と少量sampleへ限定する。
- redacted本文とstate snapshotは30日、structured metadataは90日、個別sessionへ戻れない集計だけ最大12か月保持する。
- account deletionと品質改善data削除要求で、保持中tokenに紐づくtraceをcascade deleteする。
- 本文閲覧は限定権限とaudit logを必須とする。

これはproduct decisionの確定であり、production implementation、TTL policy、account deletion処理、privacy/legal reviewが完了した意味ではない。実装完了まではproduction enablementを完了扱いにせず、traceをprofileやevaluation fixtureへ自動転用しない。

## 5. 実装statusの読み方

次の状態を別々に記録する。

```text
module implemented
production connected
automated verified
browser verified
operationally deployed
```

一つの`complete`へ丸めない。現在のcoverageは`docs/testing/weekly-planning-roleplay-status.md`を参照する。

## 6. 歴史文書

closedまたはsuperseded文書に残るsingle-interpreter、preview-first、旧stage/phase、旧queueは、その時点の履歴である。現在の実装指示として直接再実行しない。移行先は`docs/ai/tasks/closed/20260716-weekly-planning-historical-contract-migrations.md`を参照する。
