# アカウント削除とデータ保持

Status: canonical account-deletion policy / operator runbook
Updated: 2026-10-30
Owner: Issue #917

## 対象と責務

利用者は設定の「退会する」から、削除内容の確認と再認証を経て自分のアカウントを削除します。削除は取り消せません。ログインできない場合など、この操作を使えない場合はお問い合わせを案内します。管理者アカウントは自動退会の対象外とし、権限と運用上の引継ぎを確認したうえで運営者が個別対応します。

サーバーは認証済み利用者だけを対象にし、リクエスト本文の利用者IDで対象を選びません。明示確認と直近5分以内の再認証を要求します。AIの回答を削除の承認や完了判定に使いません。

本書の削除順序・保持例外は#917の実装契約です。実装、Emulator、CI、本番revision、隔離テストアカウントでの受入の完了証拠はIssue #917を正とします。

## 削除順序

削除ジョブを `account_deletions/{uid}` に先に作成します。これ以降は、同じアカウントのクライアント書込みをFirestore Rulesで拒否します。途中で失敗してもこの記録を残し、同じ処理を再実行します。

| 段階 | 処理 |
| --- | --- |
| 1 | プロフィールを削除する。週間計画traceの記録開始・追記はプロフィールの同意記録を必要とし、同意の再登録もジョブ記録がある間は拒否するため、まだ開いている別端末がtraceを追加できなくなる |
| 2 | 利用状況の対応表（UID → actor）を削除する。削除前にactor識別子をジョブ記録へ一時保存し、完了時に消す。ジョブ記録がある間は新しい対応表を作らない |
| 3 | 既存の週間計画trace削除処理を呼ぶ。旧形式も対象。アクセス監査は#45の境界を維持する |
| 4 | 問い合わせ本文、受付が参照するR2添付、送信制限を削除する |
| 5 | `userId == uid` の学習データと承認操作・その子文書を削除する |
| 6 | UIDを文書キーに持つ設定、出欠、既読、個別最適化、記憶を子文書ごと削除する |
| 7 | 保存したactorに結び付く利用状況イベント、全環境の利用者別集計、日別利用者記録、集計途中のactorフラグを削除する |
| 8 | UIDで到達できるAI利用制限のDurable Objectを消去する |
| 9 | Firebase Authenticationの利用者を削除する |
| 10 | ジョブに完了を記録する。応答を確認した端末は当該利用者のローカルデータを消去し、サインアウトする |

同時に複数の退会リクエストが届いた場合は、ジョブ記録の条件付き書込みで1件だけが処理を進めます（`leaseUntil`、最大120秒）。他のリクエストは処理中として拒否され、利用者は少し後に再試行できます。

各段階は再実行できるものとし、リクエストの処理上限に近づいたら進捗を保存して継続します。認証アカウントを先に削除して残りの処理を実行不能にしてはいけません。

## 保存先の棚卸しと削除対象

以下はソースの保存経路を確認した一覧です。実ユーザーの文書や本番ストレージは調査していません。特記しない通常データに自動保存期限はなく、退会ジョブで削除します。段階番号は上表に対応します。

### Firestore / Firebase Authentication

| 保存先 | キー・所有者 | 内容 | 退会時 |
| --- | --- | --- | --- |
| `plans`, `month_events` | 文書ID / `userId` | 旧予定・繰返し予定・メモ | 段階5。移行済み利用者の旧データも対象 |
| `schedule_events` | 文書ID / `userId` | 現行予定・繰返し・旧予定参照 | 段階5 |
| `actuals` | 文書ID / `userId` | 実績・進捗・教材や旧予定の参照 | 段階5。旧参照形式を理由に除外しない |
| `day_notes`, `todos` | 文書ID / `userId` | 日記・課題・メモ | 段階5 |
| `study_subjects`, `study_materials` | 文書ID / `userId` | 科目・個人の本棚・教材進捗 | 段階5。共有の書誌catalogとは別 |
| `schedule_templates`, `timetable_terms`, `timetable_periods` | 文書ID / `userId` | 授業・時間割・期間 | 段階5 |
| `weekly_planning_approval_operations/{id}/weekly_planning_approval_items/{id}` | 親子とも `userId` | 承認・保存済み項目・再実行制御 | 段階5。親だけ消して子を残さない |
| `schedule_event_migrations/{uid}` | UIDキー | 移行状態 | 段階6 |
| `class_attendance/{uid}/classes/{templateId}/records/{date}` | UIDの祖先パス | 授業ごとの出欠・日時 | 段階6。親文書が存在しない子孫も対象 |
| `study_rest_days/{uid}` | UIDキー / `userId` | お休みチケット・利用日 | 段階6 |
| `announcement_reads/{uid}/items/{id}` と親 | UIDキー | 個別既読と一括既読日時 | 段階6 |
| `weekly_planning_personalization_profiles/{uid}` | UIDキー | 週開始・個別最適化設定 | 段階6 |
| `user_planning_contexts/{uid}` | UIDキー / `ownerId`, `snapshot.ownerId` | 継続的な条件・記憶・履歴 | 段階6 |
| `support_inquiries/{receipt}` | 受付ID / `userId` | 本文、受付日時、schema version、添付記述子。本文・画像に本人が含めた個人情報も対象 | 段階4 |
| `support_inquiry_limits/{uid}` | UIDキー | 直近受付IDと送信日時 | 段階4 |
| `weekly_planning_trace_sessions`, `weekly_planning_trace_entries` | HMAC由来ID / `traceSubjectToken`。2026-07-18より前は生の `userId` | 会話本文・条件・仮予定・診断情報 | 段階3。既存処理で全epochと旧 `userId` 形式を削除 |
| `profiles/{uid}` | UIDキー | メール、表示名、画像、登録日時、同意記録 | 段階1 |
| Firebase Authentication | UID | ログイン識別子、メール、プロバイダー連携 | 段階9 |
| `admins/{uid}` | UIDキー / `enabled` | 管理者権限 | 自動退会を拒否し個別対応 |
| `account_deletions/{uid}` | UIDキー | 削除進捗・再出現防止・最小限の監査 | 保持例外を参照 |

保存・所有者の根拠: [Firestore Rules](../../../../firestore.rules)（所有者関数14–45行、各collection 249–651行）、[学習データrepository](../../../../src/repositories/firebasePlannerRepository.ts)（109行以降）、[現行予定の保存境界](../../../../src/repositories/firebaseScheduleEventAuthority.ts)、[出欠repository](../../../../src/repositories/firebaseClassAttendanceRepository.ts)（8行）、[学習履歴repository](../../../../src/repositories/firebaseStudyStreakRepository.ts)、[記憶repository](../../../../src/features/userPlanningContext/userPlanningContextRepository.ts)（23、228行）、[問い合わせ保存](../../../../src/services/inquiryService.ts)（52–53行）。

### Workerの保存先 / R2 / Durable Objects

| 保存先 | キー・結び付き | 内容 | 退会時・保持 |
| --- | --- | --- | --- |
| `observability_actor_directory` | UIDのHMACによる文書ID → `actorSubjectId` | アカウントと利用状況の対応 | 段階2。対象actorを解決・保存してから対応を消す |
| `observability_events` | イベントID / `actorSubjectId` | 操作・AI処理・失敗分類・会話等への相関ID | 段階7。通常は90日の期限と定期削除 |
| `observability_actor_day` | 環境:日:actor / `actorSubjectId` | 日別の利用者活動 | 段階7。通常の期限フィールドは400日 |
| `observability_user_summary_{environment}` | `actorSubjectId`。環境別にproduction / preview / development / test | 利用者別回数、日時、最終エラー等 | 段階7。自動期限はない |
| `observability_planning_session_summary` | 環境:会話ID。元イベントと会話IDで結合可能 | 会話単位の到達フラグ・回数・バージョン | 保持例外 |
| `observability_daily_rollups`, `observability_active_user_windows`, `observability_planning_daily_rollups` | 環境・日付等 | 利用者IDを含まない集計値 | 保持。期限フィールド400日。前2つは定期削除対象、planning dailyは現行対象外 |
| `observability_active_user_snapshot_accumulator` | `main:{shard}` / `actorFlags`内のactor識別子 | 集計途中の利用者別フラグ | 段階7の `observability_active_user_accumulator`。64個の固定shardから対象actor行だけを除去し、他のactorを保持。更新時刻の条件付き書込みで競合を検出 |
| `observability_active_user_snapshot_job` | `main` / actor-day文書へのcursor | 集計途中の読取位置 | 保持例外 |
| `observability_profile_registration_backfill_state` | `main` / `profiles/{uid}`等へのcursor | 登録日時補完の位置・件数 | 保持例外 |
| `observability_user_enrichment_backfill_state` | `main` / summaryへのcursor、`pendingRecentErrorScan.actorSubjectId` | 補完の読取位置・直近エラー走査状態 | 保持例外 |
| `observability_rollup_state` | `main` / 元イベントへのcursor | 集計位置・件数・日付範囲 | 保持。本文を持たない運用参照 |
| `weekly_planning_trace_access_audit` | ランダム監査ID / `actorToken`, `targetSessionId` | 調査・閲覧・削除の操作証跡 | #45の保持方針を参照 |
| R2 `INQUIRY_ATTACHMENTS` | `inquiries/{receipt}/{slot}`。受付の `userId` が所有者 | 元画像と埋込metadata、ハッシュ | 段階4。受付削除前に添付を消す。通常の自動期限はない |
| `AI_QUOTA` Durable Object | `uid:{encodeURIComponent(uid)}`（160文字上限）と `telemetry:uid:{encodeURIComponent(uid)}`、共有IPは `ip:{encodedIp}` | `quota-state`の窓ID・回数・resetAt | UIDとtelemetryの両方を段階8で削除。resetAtは回数のリセットでありストレージの自動消去ではない。共有IP分は保持例外 |
| `AI_TURNS` Durable Object | `JSON.stringify([uid, conversationId])` | `turn:meta`, `turn:input`, `turn:output`, `turn:dispatch:*` | UIDで列挙しない。本文等24時間、識別記録は保持例外 |
| `material_metadata_catalog` | ISBN等のcatalog ID | 外部提供の書誌・目次・取得元情報 | 共有資料として保持。UID・検索者情報は保存しない |
| `app_catalogs`, `announcements`, `announcement_drafts` | catalog / お知らせID | 共有教材・運営発信内容 | 個人の所有データとして削除しない。管理者は個別対応 |

根拠: [actor対応とイベント](../../../../workers/ai-proxy/src/productObservabilityStore.ts)（40–43、154–208、281行）、[集計保存](../../../../workers/ai-proxy/src/productObservabilityRollup.ts)（47–51、242–250、439–449行）、[read model型](../../../../shared/productObservabilityReadModel.ts)（103–148行）、[定期削除の対象](../../../../workers/ai-proxy/src/productObservabilityRetention.ts)（8–19行）、[集計途中のactorフラグ](../../../../workers/ai-proxy/src/productObservabilityActiveUserSnapshot.ts)（19–25、76–92、288–310行）、[登録補完](../../../../workers/ai-proxy/src/productObservabilityProfileRegistrationBackfill.ts)（13、63–74、178行）、[利用者別補完](../../../../workers/ai-proxy/src/productObservabilityUserEnrichmentBackfill.ts)（22、42–50、135–144行）、[会話別集計型](../../../../shared/productObservabilityPlanningReadModel.ts)（5–17行）、[R2添付](../../../../workers/ai-proxy/src/inquiryAttachmentApi.ts)（141–155行）、[quota](../../../../workers/ai-proxy/src/aiQuotaDurableObject.ts)（109–139行）、[quotaのキー](../../../../workers/ai-proxy/src/worker.ts)（576–578行）、[会話処理キー](../../../../workers/ai-proxy/src/durableTurns/durableTurnApi.ts)（38、58行）、[会話保存](../../../../workers/ai-proxy/src/durableTurns/durableTurnStorage.ts)、[共有書誌](../../../../workers/ai-proxy/src/materialMetadataApi.ts)（159–182行）。メール・表示名を管理画面がAuth / profilesからその都度取得する経路と、Firestoreに保存するsummaryを混同しないでください。

### 端末内の保存

完了応答を受けたブラウザでは対象UIDのデータを消去します。共有キーは対象利用者の要素だけを除き、別利用者のデータは消しません。サーバーから、閉じた別端末のストレージを遠隔消去できるとは約束しません。別端末からの古い書き戻しは削除ジョブの記録と認証境界で拒否します。

| 保存先・キー | 所有者・内容 | 完了時の対象 |
| --- | --- | --- |
| `studyplanner.plans`, `.actuals`, `.dayNotes`, `.monthEvents`, `.todos.v1`, `.studySubjects.v1`, `.studyMaterials.v1`, `.scheduleTemplates.v1`, `.timetableTerms.v1`, `.timetablePeriods.v1` | 各行の `userId`、学習データ | 対象利用者の行 |
| `studyplanner.scheduleEvents.v1`, `studyplanner.scheduleEventMigrations.v1` | 行の利用者・移行状態 | 対象利用者の行 |
| `studyplanner.users`, `studyplanner.local.passwords`, `studyplanner.session` | ローカル認証のuser / password行・セッションUID | 対象user IDの行・一致するsession。Firebaseのパスワード保存先ではない |
| `studyplanner.classAttendance.v1:{uid}:*`, `studyplanner.studyRestDays.v1:{uid}` | URL符号化UID、出欠・お休み | UID一致キー |
| `studyplanner.activeSession.v1.{uid}` | URL符号化UID、タイマーと予定のコピー | UID一致キー |
| `studyplanner.weeklyPlanning.{uid}.*`, `.activeSession.{uid}`, `.stableV5.{uid}.*` | UID、会話・Fact Graph・計画途中の状態 | UID一致キー |
| `studyplanner.weeklyPlanningUnreadable.v1.{uid}.*` | URL符号化UID、読めない旧snapshotの保管 | UID一致キー。通常データと別に残さない |
| `studyplanner.aiPlanning.chats.v1.{uid}`, `.chat.v1.{uid}.*`, `.chatSearch.v1.{uid}.*` | UID、会話一覧・本文・検索テキスト | UID一致キー |
| `studyplanner-weekly-approval-ledger-v1` / `studyplanner-weekly-approval-ledger-v2.{uid}` | 旧共有台帳のowner / URL符号化UID | 対象要素 / UID一致キー |
| `studyplanner-weekly-personalization-v1:{uid}`, `studyplanner.userPlanningContext.{uid}` | 前者URL符号化UID、個別最適化・記憶 | UID一致キー |
| `studyplanner-weekly-planning-trace-sessions-v1`, `studyplanner-weekly-planning-trace-entries-v1`, `studyplanner.weeklyPlanning.trace.outbox.v1` | 共有配列内の利用者・送信待ち本文 | 対象利用者の要素 |
| `studyplanner.weeklyPlanning.trace.stableV5.{uid}::*`, `.serverHandle.v1.{uid}::*` | URL符号化UID、trace cursor / server handle | UID一致キー |
| `studyplanner.durableWeeklyTurn.v1:{uid}` | URL符号化UID、処理復帰情報 | UID一致キー。通常は24時間で読取拒否 |
| 旧 `studyplanner.startup-schedule.v1:*` | 廃止済みの予定表示コピー。現行コードは書き込まない | [起動時の廃止処理](../../../../src/lib/retiredStartupPreviewCache.ts)で除去する。保存領域の操作失敗時は消去済みと扱わない |
| `studyplanner:material-detail:v1:{uid}:*`, `study-planner-month-timetable:{uid}`, `study-planner-{view}-timetable:{uid}`, `study-planner-study-progress:{uid}` | 教材詳細は生UID、その他URL符号化UID、個人表示設定 | UID一致キー |
| sessionStorage `laplance.inquiry-receipt.v1` | `userId`、受付IDと添付記述子。本文・画像本体はメモリのみ | 対象利用者なら消去 |
| sessionStorage `studyplanner.aiPlanning.moduleRecovery.v1` | `binding.ownerId`、入力・添付の復帰capsule | 対象利用者なら消去。通常の有効期限は30分、読取時に検査 |
| Firebase Auth SDKのブラウザ保存領域 | ログインセッション | サインアウト。Firestore永続cacheが存在すれば消去対象 |
| `study-planner-appearance`, `study-planner-theme-mode`, `study-planner-theme-palette`, `study-planner-font-preset`, `study-planner-motion`, `study-planner-home-scene-*` | 端末共通の外観、UID・本文なし | 保持可 |
| sessionStorage `studyplanner.ai.runtime.v1` / localStorage `studyplanner.nl.current-pipeline-only` | 開発用の接続設定 / pipelineフラグ、アカウント単位ではない | アカウント所有データと扱わない。外部APIキーは利用者データと一緒にログへ出さない |

根拠: [ローカル学習データ](../../../../src/repositories/localStorageGateway.ts)（25–36行）、[ローカル認証](../../../../src/repositories/localAuthStorageGateway.ts)（4–7行）、[予定移行](../../../../src/repositories/localScheduleEventAuthority.ts)（25–26行）、[週間計画の所有ストレージ](../../../../src/features/weeklyPlanning/weeklyPlanningOwnedStorage.ts)（48–56行）、[会話履歴](../../../../src/features/weeklyPlanning/chat/aiPlanningChatStore.ts)（34–42行）、[未読snapshot保管](../../../../src/features/weeklyPlanning/weeklyPlanningStorageRetention.ts)（4、59行）、[trace送信待ち](../../../../src/features/weeklyPlanning/trace/weeklyPlanningTraceOutbox.ts)（4行）、[問い合わせ復帰](../../../../src/services/inquiryDraft.ts)（7–26行）、[会話画面の復帰](../../../../src/features/weeklyPlanning/chat/aiPlanningModuleRecovery.ts)（19–26行）。[Firebase初期化](../../../../src/lib/firebaseClient.ts)はFirestoreの永続cacheを明示的に有効化していません。保持期限の読取検査だけでは、未起動ブラウザから物理削除された証拠にはなりません。

## 保持例外・理由・期限

法的保存義務を理由にしていません。「完全に匿名化」「利用者と結び付かない」とは表現しません。期限フィールドの存在と、実際に削除する仕組みの存在を区別します。

| 保持するもの | 理由 | 期限・消去の境界 |
| --- | --- | --- |
| `account_deletions/{uid}` | 古い端末からの再出現防止、進捗復旧、削除の監査 | 作成時は受付から180日、完了時に完了から180日へ更新する。定期処理で期限切れを削除。失敗中にAuthだけ削除済みでも作成時期限が残る |
| traceアクセス監査 | 閲覧・調査・削除操作の説明可能性 | [#45のtrace契約](../../weekly-planning/architecture/weekly-planning-conversation-trace.md)と[privacy / lifecycle記録](../../weekly-planning/work/20260731-trace-privacy-and-lifecycle.md)に従う。#917では変更しない |
| AI_TURNSの入力・provider応答・結果 | 非同期処理の復帰 | 受付から最大24時間。期限でalarm / 読取処理が本文等を除去 |
| AI_TURNSの期限切れwatermark | 同じ古いリクエストの重複実行防止 | 本文・IP・provider応答なし。UID、会話ID、request ID、revision、digest、status、日時は会話単位で残る。自動削除期限なし。UIDとの対応を保持するため匿名とは扱わない |
| 会話別集計 `observability_planning_session_summary` | 会話の到達率・障害傾向を確認する診断 | 本文・アカウントIDなし。会話IDとflags / count / version。120日の期限フィールドはあるが現行sweeper対象外で、自動削除期限を保証できない。AI_TURNSの会話IDを介した照合は可能 |
| backfill / scan cursorと補完の保留状態 | 既存の集計処理を途中から再開する | `profiles/{uid}`、actor ID、文書名等への参照が次の更新まで残り得る。固定日数や自動消去期限はない。本文・メールは含めない |
| 利用者識別子のない日別 / window / planning日別集計 | 全体の利用傾向の比較 | 400日の期限フィールド。実際のsweeper対象は上表を参照。退会時に個人分を差し引く処理は行わない |
| AI_QUOTAのIP共有bucket | 同じ送信元からの過負荷防止 | UID単位に帰属できない共有回数。窓はminute / dayでリセットするが自動ストレージ消去期限なし。会話本文は含めない |
| 外部サービスのログ・バックアップ | 各サービスの運用 | Firebase / Cloudflare / 外部AIサービス等の設定・契約に従う。このrepositoryから確定できない日数を約束しない |

AI_TURNSの根拠は[処理レコード](../../../../workers/ai-proxy/src/durableTurns/durableTurnJob.ts)（10、15–42、96–99、199–205行）。期限切れwatermarkは#917の削除ジョブでは列挙・削除しません。

## 監査証跡

`account_deletions/{uid}` は削除進捗と再出現防止を兼ねる最小限の監査記録です。UID、受付・更新・完了日時、試行数、完了段階、削除件数、最終エラーコード、Worker revision、期限を保存します。処理中だけ、実行権（`leaseUntil`）と利用状況actor識別子を一時的に持ち、完了時に消します。メール、問い合わせ本文、学習内容、認証トークンは保存しません。クライアントは自分の記録の取得のみ可能で、作成・更新・削除や一覧取得はできません。

週間計画traceの削除操作は既存の#45アクセス監査を使います。別のtrace監査・削除方式を追加しません。匿名化済みという理由でこれらの記録を無期限に増やす運用はしません。

## 運用手順: 止まった削除を調べる

1. 問い合わせ本人の確認と、調査対象UIDの対応を認可された管理経路で確認します。任意のUIDをAPI本文へ渡して削除しようとしてはいけません。
2. 権限のあるFirestore管理画面で `account_deletions/{uid}` を個別取得します。`status`, `updatedAt`, `attempts`, `completedSteps`, `deletedCounts`, `lastErrorCode`, `workerRevision` を確認します。利用者へ内部コードや秘密情報を貼る必要はありません。
3. `status == deleting` の場合、最後に完了した段階と `lastErrorCode` を起点に、該当Worker revisionと失敗した依存先の応答を照合します。通信断だけで失敗とも完了とも決め付けません。`lastErrorCode` がなくても未完了は未完了です。
4. 利用者には同じ設定の退会ダイアログで再試行してもらいます。未完了ジョブを検出したログインでは同じ再試行画面を出し、通常の編集へ戻しません。再認証が必要ならパスワード入力またはGoogle再認証をやり直します。`in_progress` はクライアントが続きの呼出しを行います。
5. `completed` はサーバーが完了を書き込んだ証拠です。完了応答を確認した端末のローカル消去とサインアウトは別途確認します。Authがすでに消え、完了記録や応答だけが確認できない場合は、利用者へ再認証を繰り返させず、管理経路でAuth不在と各削除段階を照合してエスカレーションします。
6. 復旧のために必要な修正・再実行は、同じジョブとコードの責任境界で行い、Issueにrevision、段階、分類した原因、検証結果を残します。実データをIssueやログへ転載しません。

禁止事項:

- ジョブや `completedSteps` を手で消す、完了へ書き換える、再出現防止を外す。
- 残りの削除が終わる前にAuthアカウントを手動削除する。
- 別利用者の文書、共有集計、共有IP bucketを一括削除して復旧する。
- 認証トークンや鍵をブラウザ保存領域から抜き出してセッションを再構築する。
- 本番の実ユーザーや共有テストアカウントを受入テストの削除対象にする。
- 一部の段階の成功、HTTP 401、アプリ上のサインアウトだけで全削除完了を宣言する。
