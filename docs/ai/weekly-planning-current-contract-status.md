# weeklyPlanning current contract status

Status: canonical / active status overlay
Updated: 2026-07-22
Current implementation baseline: `48fe92669b016c2e96463578df86dc79589ddc01`

- Roadmap: [strategy/weekly-planning-roadmap.md](strategy/weekly-planning-roadmap.md)
- PR #75 completion and seven-audit record: [tasks/closed/20260722-weekly-planning-ai-only-semantic-boundary-and-seven-audit.md](tasks/closed/20260722-weekly-planning-ai-only-semantic-boundary-and-seven-audit.md)
- PR #5 historical post-merge status: [weekly-planning-pr5-post-merge-status.md](weekly-planning-pr5-post-merge-status.md)
- Approval stream completion: [tasks/closed/20260716-weekly-planning-approval-persistence-and-idempotency.md](tasks/closed/20260716-weekly-planning-approval-persistence-and-idempotency.md)
- Approval operational rollout: [tasks/20260718-weekly-planning-approval-operational-rollout.md](tasks/20260718-weekly-planning-approval-operational-rollout.md)
- Personalization foundation completion: [tasks/closed/20260718-weekly-planning-personalization-foundation.md](tasks/closed/20260718-weekly-planning-personalization-foundation.md)

## 1. 役割と優先順位

この文書は、product spec、dialogue architecture、roleplay test plan、task mdに残る古い実装statusと未決定contractの読み方を統一する。

```text
確定済みproduct decision
→ current implementation facts / PR #75 completion record
→ roadmap Decision gates / current queue
→ roleplay coverage status
→ active architecture/spec/testの未競合部分
→ active tasks
→ PR #5等のhistorical snapshot
→ closed/superseded/audit records
```

queueはroadmapだけを正とする。spec、architecture、roleplay、過去PR本文に残る旧queue、branch名、head、`queued`、`draft`はcurrent queueとして使用しない。

## 2. AI意味解釈と決定論的core

PR #75は2026-07-22に`main`へmergeされ、自然言語の初期意味解釈責務をAI interpreterへ一本化した。

- raw user textから意図、対象、訂正、省略、指示関係、優先関係、生活制約等の意味を生成する主体はAI interpreterだけとする。
- production executorはAI interpreter付きpipelineだけを使用し、rules providerまたはAI設定不備では`WeeklyPlanningSemanticInterpreterError`としてfail closedする。
- provider例外、不正JSON、schema不一致、空応答、候補全拒否、repair失敗でもrules parserまたはlegacy parserへfallbackしない。
- AIはtyped command候補を返し、決定論的coreはshape、enum、値域、公開参照、confirmed slot、重複、競合、revision、readiness、feasibilityを検証・適用する。
- validator、reference resolver、canonicalizer、behavior planner、safety層はraw user textを正規表現、キーワード、数値抽出、近似一致で再解釈しない。
- 意味出力が空の場合はAI repairを一度だけ行い、修復できなければ以前の意味状態と質問文脈を維持して失敗通知を返す。
- failed/rejected turnではassistant-suggested mutation、preview、draft candidate、assumption artifact、diagnosticsを生成しない。
- AIはstate、missing、質問対象、readiness、preview可否、scheduler、approval、saveを直接決定しない。
- 確定済み属性を異なるAI候補で破壊的に上書きせず、高影響の不確実性だけを一度に一件確認する。
- accepted stateと直近user turnに根拠がある事項だけを短くacknowledgeする。

旧`deterministic baselineを先に適用し、AI candidateと属性単位mergeする`契約、成功AI経路の後段raw-text補完、provider failure時のparser fallbackはhistoricalであり、current contractではない。legacy parserは明示的なtest-support境界にのみ残す。

## 3. planning rangeと週の始まり

Product decisionは2026-07-16に確定した。

- 初回だけ、週の始まりを月曜日または日曜日から利用者に確認する。
- 選択をaccount-linked personalization profileへ保存する。
- 以後の「今週」「来週」は保存済み設定に従って一意解決する。
- 今回の発話で具体的な開始日・終了日・曜日範囲が指定された場合は、その明示指定を優先する。
- 利用者は設定または会話によって週の始まりを変更できる。
- profileが未設定、破損、競合している場合だけ明示的修復へ入る。

PR #24で期間短答と片側終了境界、PR #26で漢数字絶対日付guardを実装・自動検証した。account-linked week-start profileはPR #48で`main`へmergeされ、module実装、production接続、自動検証まで完了している。

本番運用、同意、削除、監査、週始まり変更時の既存session移行は個別最適化データガバナンスタスクへ残る。

## 4. sessionと非同期lifecycle

current contractは次である。

- 会話messages、intake state、preview候補、draftは`PlanningState`をsession ownerとする。
- 保存対象sessionはclosed storage validatorを通す。
- `pendingTurn`、`pendingApproval`、session-local proposal recordはload時に除去する。
- conversation ID、turn ID、request ID、対象週、開始revisionの不一致はstale resultとして扱う。
- pending turnまたはapproval中の許可されていないmutationを拒否する。
- `clear_conversation`、`reset_session`、account profile resetを別操作として扱う。
- retryは新しいturn IDとrequest IDを持つ。

```text
modal close / presentation component unmount
  → sessionを維持する。完了resultはsessionへcommitできる

selected week変更 / session reset / explicit cancellation / ownership不一致
  → 旧resultを現在stateへ適用しない

browser reload中の未完了request
  → network requestは再開しない。保存sessionから一時ownershipを除去する
```

entrypoint ownership実装はconversation/turn/request identity、explicit cancellation、clear conversation、Ctrl/Meta+Enter、IME guard、focus restorationをproductionへ接続した。実ブラウザ確認は未完了である。

週単位conversation sessionのクラウド同期、revision競合、offline cache、legacy migrationは未実装であり、active taskを正とする。

## 5. previewとapproval

### 5.1 Preview生成と承認前検証

- previewはexplicit authorizationとreadiness gate通過後だけ生成する。
- assistantが仮予定作成を提案しただけではpreviewを生成しない。
- previewはexplicit UI approvalまでrepositoryへ保存しない。
- preview候補はsession stateで所有し、個別削除、全破棄、draft昇格を扱う。
- stale previewとpending-assumption previewを保存前に拒否する。
- behavior-aware previewのrevisionはintake stateのrevision domainであり、`PlanningState.revision`と直接比較しない。
- preview authorizationには当該turnの実conversation IDを用いる。
- assumption dependency検証には実proposal recordsを使用する。
- 未ログイン状態ではapproval operationを開始しない。

PR #54とPR #55でapplication harnessと実session bindingを実装・自動検証した。

### 5.2 保存副作用とin-flight ownership

- 週間承認は手動editor用`savePlanDraft`を使用しない。
- 承認専用保存はselectedDate、monthDate、view、editor、noticeを変更しない。
- repositoryが返した実Plan IDをoperationへ記録する。
- optimistic rollbackは失敗したPlanだけをfunctional updateで除去する。
- 各item開始前とduplicate lookup後にapproval ownershipを再確認する。
- resetまたは週変更後は次itemのlookup/saveを開始しない。
- ownership喪失後は旧stateへ完了・失敗messageをdispatchしない。

PR #56とPR #57で実装・自動検証した。

### 5.3 browser reload後の復元仮予定

- modal close/reopenは同一JavaScript session内のpresentation lifecycleであり、runtimeが維持される限り承認可能状態を保つ。
- browser reload後はsession runtimeとsession-only proposal recordsを信頼可能に復元できないため、behavior-aware仮予定をそのまま承認しない。
- 復元案は参考表示し、最新条件での再計算を明示する。
- 再計算必須時は承認操作を表示しない。
- approval domainのfail-closed guardを維持する。
- legacy metadataなしblockの互換経路を維持する。

PR #58で実装・自動検証した。実ブラウザのreload表示確認は未完了である。

### 5.4 user-boundary storage

- 週間計画stateは`version + ownerId + payload`の同一envelopeとして保存する。
- owner不一致、cross-user draft、破損payloadをfail closedで破棄する。
- user/week scope切替renderで旧stateを新keyへ保存しない。
- local approval ledgerはuser別keyへ分離する。
- 旧global ledgerはoperation.userId単位で安全に分割移行する。
- blank/anonymous ownerではledgerを復元しない。

PR #59で実装・自動検証した。

### 5.5 server-side persistent idempotency

- Planへ`sourceType: weekly-planning`とversion付き`sourceId`を保存する。
- `userId + approvalOperationId + sourceDraftBlockId`をserver-side item identityとする。
- operation progress、item、PlanをFirestore transactionで原子的に保存する。
- deterministic Plan document IDで同一itemの同時保存を一件へ収束させる。
- clientの`plans` snapshotやlocalStorage ledgerをmulti-client duplicate判定の正本にしない。
- itemまたはoperation progress消失時はdurable Plan provenanceとitem記録から復旧する。
- item保存済みでPlanが欠落する場合は再作成せずfail closedとする。
- server finalize失敗時はPlanを再保存せずfinalizeだけを再試行する。
- operation/itemのowner、identity、進捗単調性をFirestore rulesで制約する。
- operationと`weekly_planning_approval_items`の双方へ180日TTL用`expiresAt`を保存する。

PR #60、PR #62、PR #63で実装・自動検証した。

次が完了するまではoperationally deployedと扱わない。

- 本番Firestore rules deploy
- `weekly_planning_approval_operations.expiresAt` TTL policy
- `weekly_planning_approval_items.expiresAt` TTL policy
- Firestore Emulator rules/transaction tests
- 2tab・2端末相当の実環境確認

active taskは`tasks/20260718-weekly-planning-approval-operational-rollout.md`を正とする。

## 6. conversation traceと長期個別最適化データ

### 6.1 共通利用条件

- 個別最適化、品質改善、不具合調査のためのデータ収集・利用を週間計画機能の利用条件とする。
- 毎conversationではなく、初回利用前の利用規約・privacy noticeで目的、収集範囲、保存期間、削除方法、必須性を説明する。
- 方針を受け入れない利用者はaccount-linked personalizationを前提とする週間計画を開始できない。
- 利用開始後の停止・削除要求は、週間計画機能またはaccountの終了と関連データ削除へ接続する。

### 6.2 Quality trace

- raw Firebase UID、メール、表示名をtraceへ保存しない。
- server-side HMACの期間限定subject tokenを使い、30日単位でrotationする。
- redacted本文、state snapshot、structured metadataは180日保持する。
- account deletion時は保持中tokenに紐づくtraceをcascade deleteする。
- 本文閲覧は限定権限とaudit logを必須とする。

PR #46でcode実装と自動検証は完了した。本番secret、TTL policy、rules/Worker deploy、削除・限定閲覧の実環境確認、privacy/legal reviewは未完了である。

### 6.3 Longitudinal personalization profile

PR #48は2026-07-18に`main`へmerge済みである。

実装済みfoundation:

- account-linked versioned profile
- profile factのorigin、confidence、scope、confirmedAt、expiresAt
- 週の始まり設定と自然言語解釈への反映
- 設定画面からの変更とprofile reset
- traceとは別のrepository、collection、Firestore権限
- 一時的な相談条件を長期profileへ自動昇格しない境界

未完了:

- 週途中の現在時刻境界
- 週session同期と競合処理
- 相談resetと派生観測無効化
- plan／actualからのversion付き観測記録
- 見積り補正、session長、時間帯傾向の集計
- 時間減衰、不確実性、既定値への縮約
- 個人別placement score
- 規約version、TTL、削除cascade、admin audit、privacy/legal review

個別最適化のqueueと依存順はroadmapを正とし、foundation完了記録とactive taskを混同しない。

## 7. 実装statusの読み方

次の状態を別々に記録する。

```text
module implemented
production connected
automated verified
browser verified
operationally deployed
```

PR本文またはcompletion recordのtest成功を、現在`main`のbrowser verificationや本番deployへ自動継承しない。

## 8. Task operation

- `tasks/`直下には未完了taskだけを置く。
- 完了した範囲は`tasks/closed/`へcompletion recordとして保存する。
- broad parent Issueは進捗索引としてopenを維持し、実装責務は依存付きtask mdへ分離する。
- current queue、priority、blocked状態はroadmapを正とする。
- historical、closed、superseded文書をcurrent instructionとして直接実行しない。
