# weeklyPlanning current contract status

Status: canonical / active status overlay
Updated: 2026-07-17
Current main merge baseline: `55f8e32c68cfd057494fadec0ed208cba267db12`
Post-merge status: [weekly-planning-pr5-post-merge-status.md](weekly-planning-pr5-post-merge-status.md)

## 1. 役割

この文書は、product spec、dialogue architecture、roleplay test planに残る古い実装status、queue、未決定contractの読み方を統一する。

優先順位は次のとおりである。

```text
確定済みproduct decision
→ current implementation facts
→ weekly-planning-pr5-post-merge-status.md
→ roadmap Decision gates / current queue
→ roleplay coverage status
→ active architecture/spec/testの未競合部分
→ active tasks
→ historical/closed/superseded records
```

queueはroadmapだけを正とする。spec、architecture、roleplay内の古いqueue、branch名、head、`queued` statusはcurrent queueとして使用しない。

## 2. AIとdeterministic parser

Product decisionは2026-07-16に確定し、PR #5で`main`へ実装された。

- legacy fallbackを含まないdeterministic baselineを先に適用する。
- 明示的な日付、曜日、時刻、数値、単位、現在質問への短答、確定済み情報の保護をdeterministic責務とする。
- AIは曖昧な言い換え、複数文の関係、訂正対象、タスク種別、優先関係等のsemantic補完を担当する。
- deterministic resultとAI candidateは、属性単位のclosed validatorと保護規則を通して補完する。
- 確定済み属性を異なるAI候補で破壊的に上書きしない。
- AI解釈が高信頼でない場合は、不確実性の影響と質問コストを評価し、明示的修復またはやり過ごしへ分類する。
- previewを止める高影響の不確実性だけを一度に一件確認する。
- 計画を止めない不確実性は未解決topicとして保持し、そのturnでは質問しない。
- 確認済み事項は、accepted stateと直近user turnに根拠がある場合だけ短い反復でacknowledgeする。
- AIが生成した未根拠acknowledgementは表示しない。

2026-07-17時点の`main`には、deterministic baseline + AI semantic補完、明示的修復、やり過ごし、grounded acknowledgementが入っている。

旧`single AI interpreter / no merge`記述はcurrent contractではない。product spec §12–13、dialogue architecture §1–2、roleplay planの`DA-INTERPRET-001`と`DA-FALLBACK-001`に残る競合記述は、この節とpost-merge statusで上書きする。

## 3. planning rangeと週の始まり

Product decisionは2026-07-16に確定した。

- 初回だけ、週の始まりを月曜日または日曜日から利用者に確認する。
- 選択をaccount-linked personalization profileへ保存する。
- 以後の「今週」「来週」は保存済み設定に従って一意解決し、毎回開始日を聞かない。
- 今回の発話で具体的な開始日・終了日・曜日範囲が指定された場合は、その明示指定を優先する。
- 利用者は設定または会話によって週の始まりを変更できる。
- profileが未設定、破損、競合している場合だけ明示的修復へ入る。

現在の`main`にはaccount-linked week-start profileは未実装である。PR #5では、期間名、具体的な開始日、日数を分離したpending planning range契約を実装し、`next_week`を7日へcanonicalizeした。期間名だけの未来期間は、開始日・日数未確定のまま保持できる。

既知の機能バグとして、漢数字を含む絶対日付の`日`を日曜日として誤解釈する可能性がある。Issue #21と`20260717-weekly-planning-kanji-absolute-date-guard.md`をP0として扱う。

## 4. sessionと非同期lifecycle

PR #5 merge後のcurrent contractは次である。

- 会話messages、intake state、preview候補、draftは`PlanningState`をsession ownerとする。
- 保存対象sessionはclosed storage validatorを通す。
- `pendingTurn`、`pendingApproval`、session-local proposal recordはload時に除去する。
- request ID、対象週、開始revisionの不一致はstale resultとして扱う。
- pending turnまたはapproval中の許可されていないmutationを拒否する。
- `clear_conversation`と`reset_session`を別操作として扱う。

表示上modalを閉じることと、session cancelは同じではない。

```text
modal close / presentation component unmount
  → sessionを維持する。完了resultはsessionへcommitできる

selected week変更 / session reset / explicit cancellation / revision不一致
  → 旧resultを現在stateへ適用しない

browser reload中の未完了request
  → network requestは再開しない。保存sessionから一時ownershipを除去する
```

architecture、verification task、roleplay planに残る「closeまたはpresentation unmountだけでactive requestを無効化する」という記述はcurrent contractではない。

## 5. previewとapproval

- previewはexplicit authorizationとreadiness gate通過後だけ生成する。
- assistantが仮予定作成を提案しただけではpreviewを生成しない。
- previewはexplicit UI approvalまでrepositoryへ保存しない。
- preview候補はsession stateで所有し、個別削除、全破棄、draft昇格を扱う。
- stale previewとpending-assumption previewを保存前に拒否する。
- item ledgerは`userId + sourceDraftBlockId`をkeyにpartial retryと同一browser内のduplicate抑止を行う。

現行ledgerはlocalStorage境界であり、multi-tab、別端末、storage消去後の重複保存を完全には防げない。server-side persistence taskをP1として扱う。

## 6. conversation traceと長期個別最適化データ

Product decisionは2026-07-16に確定した。

### 6.1 共通利用条件

- 個別最適化、品質改善、不具合調査のためのデータ収集・利用を週間計画機能の利用条件とする。
- 毎conversationではなく、初回利用前の利用規約・privacy noticeで目的、収集範囲、保存期間、削除方法、必須性を説明する。
- この必須収集だけを停止して、同じ個別最適化サービスを継続するopt-out modeは提供しない。
- 方針を受け入れない利用者は週間計画機能を開始できない。
- 利用開始後の停止・削除要求は、週間計画機能またはアカウントの終了と関連データ削除へ接続する。

### 6.2 Quality trace

実装契約は`docs/ai/tasks/20260716-weekly-planning-trace-privacy-and-lifecycle.md`を正とする。

- raw Firebase UID、メール、表示名をtraceへ保存しない。
- server-side HMACの期間限定subject tokenを使い、30日単位でrotationする。
- 暗号化は安全管理措置であり、匿名化の代替として扱わない。
- redacted本文、state snapshot、structured metadataは180日保持する。
- 個別sessionへ戻れない集計だけ最大24か月保持する。
- account deletion時は保持中tokenに紐づくtraceをcascade deleteする。
- 本文閲覧は限定権限とaudit logを必須とする。

conversation trace moduleとapplication instrumentationは存在するが、production subject token、redaction、TTL、deletion、access control、acceptance gateは未実装または未検証である。

### 6.3 Longitudinal personalization profile

実装契約は`docs/ai/tasks/20260716-weekly-planning-longitudinal-personalization-data-governance.md`を正とする。

- profileはaccount IDへひも付く保有個人データとして扱う。
- 週の始まり、学習速度、見積り誤差、session長、修正傾向、実績差、確認方法の好みを構造化して保持する。
- 原会話とstate snapshotは180日で削除し、必要な情報だけをorigin、confidence、scope、confirmedAt付きprofile factへ昇格する。
- profileはアカウント存続中保持する。
- account deletion後はprimary storageから30日以内、backupから最大90日以内に消去する。
- trace tokenとaccount-linked profile identityを混同しない。
- 自由記述に病歴、通院、診療、障害等が含まれ得るため、不要な医療詳細は長期profileへ保存せず、必要な生活制約へ一般化する。

これはproduct decisionの確定であり、production implementation、TTL policy、profile schema、account deletion処理、利用規約、privacy/legal reviewが完了した意味ではない。

## 7. 実装statusの読み方

次の状態を別々に記録する。

```text
module implemented
production connected
automated verified
browser verified
operationally deployed
```

PR本文またはcompletion recordのtest成功を、現在`main`のbrowser verifiedまたはoperationally deployedへ自動昇格しない。現在coverageは`docs/testing/weekly-planning-roleplay-status.md`を参照する。

## 8. 歴史文書と既知の競合

closedまたはsuperseded文書に残るsingle-interpreter、preview-first、旧stage/phase、旧queue、旧30日trace保持は、その時点の履歴である。現在の実装指示として直接再実行しない。

2026-07-17の整合性監査で、次のactive文書内にも旧記述が残ることを確認した。

- product spec §12–13: single interpreter、no merge、旧queue
- dialogue architecture §1–2、§11–12: single interpreter、no merge、旧branch status、旧queue
- roleplay test plan: no-merge assertion、close/unmount cancel、旧status列

これらの実装statusと競合contractは、本書、post-merge status、roadmap、roleplay statusで上書きする。長大文書の全面同期は、機能修正と混ぜずdocs-only taskとして扱う。
