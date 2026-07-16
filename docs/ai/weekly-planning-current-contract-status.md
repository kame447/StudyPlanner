# weeklyPlanning current contract status

Status: canonical / active status overlay
Updated: 2026-07-16

## 1. 役割

この文書は、product spec、dialogue architecture、roleplay test planに残る古い実装status、queue、未決定contractの読み方を統一する。

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

Product decisionは2026-07-16に確定した。

- legacy fallbackを含まないdeterministic baselineを先に適用する。
- 明示的な日付、曜日、時刻、数値、単位、現在質問への短答、確定済み情報の保護をdeterministic責務とする。
- AIは曖昧な言い換え、複数文の関係、訂正対象、タスク種別、優先関係等のsemantic補完を担当する。
- AI解釈が高信頼でない場合は、不確実性の影響と質問コストを評価し、明示的修復またはやり過ごしへ分類する。
- previewを止める高影響の不確実性だけを一度に一件確認する。
- 計画を止めない不確実性は未解決topicとして保持し、そのturnでは質問しない。
- 確認済み事項は、accepted stateと直近user turnに根拠がある場合だけ短い反復でacknowledgeする。
- AIが生成した未根拠acknowledgementは表示しない。

2026-07-16時点の`main`はdeterministic baseline + AI補完を実装している。明示的修復、やり過ごし、grounded acknowledgementの追加実装はPR #5上にあり、merge前のため`main`実装済みとは扱わない。

旧single-interpreter / no-merge記述はcurrent contractではない。spec、architecture、roleplay、prompt、testを順次この決定へ同期する。

## 3. 「来週」と週の始まり

Product decisionは2026-07-16に確定した。

- 初回だけ、週の始まりを月曜日または日曜日から利用者に確認する。
- 選択をaccount-linked personalization profileへ保存する。
- 以後の「今週」「来週」は保存済み設定に従って一意解決し、毎回開始日を聞かない。
- 今回の発話で具体的な開始日・終了日・曜日範囲が指定された場合は、その明示指定を優先する。
- 利用者は設定または会話によって週の始まりを変更できる。
- profileが未設定、破損、競合している場合だけ明示的修復へ入る。

2026-07-16時点の`main`はpending planning rangeを保持する旧挙動であり、このprofile設定と一意解決は未実装である。

## 4. conversation traceと長期個別最適化データ

Product decisionは2026-07-16に確定した。

### 4.1 共通利用条件

- 個別最適化、品質改善、不具合調査のためのデータ収集・利用を週間計画機能の利用条件とする。
- 毎conversationではなく、初回利用前の利用規約・privacy noticeで目的、収集範囲、保存期間、削除方法、必須性を説明する。
- この必須収集だけを停止して、同じ個別最適化サービスを継続するopt-out modeは提供しない。
- 方針を受け入れない利用者は週間計画機能を開始できない。
- 利用開始後の停止・削除要求は、週間計画機能またはアカウントの終了と関連データ削除へ接続する。

### 4.2 Quality trace

実装契約は`docs/ai/tasks/20260716-weekly-planning-trace-privacy-and-lifecycle.md`を正とする。

- raw Firebase UID、メール、表示名をtraceへ保存しない。
- server-side HMACの期間限定subject tokenを使い、30日単位でrotationする。
- 暗号化は安全管理措置であり、匿名化の代替として扱わない。
- redacted本文、state snapshot、structured metadataは180日保持する。
- 個別sessionへ戻れない集計だけ最大24か月保持する。
- account deletion時は保持中tokenに紐づくtraceをcascade deleteする。
- 本文閲覧は限定権限とaudit logを必須とする。

### 4.3 Longitudinal personalization profile

実装契約は`docs/ai/tasks/20260716-weekly-planning-longitudinal-personalization-data-governance.md`を正とする。

- profileはaccount IDへひも付く保有個人データとして扱う。
- 週の始まり、学習速度、見積り誤差、session長、修正傾向、実績差、確認方法の好みを構造化して保持する。
- 原会話とstate snapshotは180日で削除し、必要な情報だけをorigin、confidence、scope、confirmedAt付きprofile factへ昇格する。
- profileはアカウント存続中保持する。
- account deletion後はprimary storageから30日以内、backupから最大90日以内に消去する。
- trace tokenとaccount-linked profile identityを混同しない。
- 自由記述に病歴、通院、診療、障害等が含まれ得るため、不要な医療詳細は長期profileへ保存せず、必要な生活制約へ一般化する。

これはproduct decisionの確定であり、production implementation、TTL policy、profile schema、account deletion処理、利用規約、privacy/legal reviewが完了した意味ではない。実装完了まではproduction enablementを完了扱いにしない。

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

closedまたはsuperseded文書に残るsingle-interpreter、preview-first、旧stage/phase、旧queue、旧30日trace保持は、その時点の履歴である。現在の実装指示として直接再実行しない。移行先は`docs/ai/tasks/closed/20260716-weekly-planning-historical-contract-migrations.md`を参照する。
