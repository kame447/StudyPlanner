# VNext conversation shared session

Status: active / shared persistence foundation implemented; application integration pending
Priority: P1 architecture / persistence
Updated: 2026-11-07
Tracking: Issue #47
Architecture dependency: Issue #164
Branch: `feat/issue47-conversation-sync`
Base: `67ea8b5ce0b2d34327b486ab43414164bcb97aec`

## 現在地とリリース境界

本番VNextは、引き続き `weeklyPlanningVNextLocalSession` と既存chat storeの端末内保存を使う。今回の変更は共有保存、競合検出、端末内outboxの基盤であり、`useWeeklyPlanningVNextApplication` の読込・送信・承認・チャット一覧にまだ接続していない。別端末で現在のアプリを開けば会話が復元される、という完成状態ではない。Issue #47を閉じず、個別最適化の学習も本変更の対象外とする。

実装の入口は `src/features/weeklyPlanning/vnext/sync/`。同期の状態遷移、実VNext codecを使うpayload検証、Firestore adapter、IndexedDB adapterを分離した。既存の予定承認・保存のauthorityは変更しない。ローカルの新規worktreeで実装し、既存の実績保存・障害回復・V5 draft移行の各PRへ混ぜていない。

## 保存方式の決定（#164 DATA-001）

Firestore Web SDKの永続cacheをそのまま会話の同期キューにすると、オフライン後の更新を一般的なlast-write-winsとして扱う経路と、明示的なrevision比較が競合する。今回必要な古い版の拒否、同一operationの再送、競合候補の保持を、そのcacheだけの成功通知へ委ねない。

localStorageへcore、UI、送信待ちをそれぞれ追加保存する案は採用しない。複数キーを一つのdurable transactionにできず、複数tabの読込→更新も原子的でないためである。既存localStorageは本番の未移行経路として残し、新しい共有正本とは扱わない。

共有状態の正本はFirestore transaction、端末のreplicaとoutboxはapplication-owned IndexedDBとする。Firestoreの別のpersistent cacheは有効化せず、二つのオフラインキューを作らない。UI接続時は、既存端末内データを破壊しない移行、書込完了前の「保存済み」禁止、失敗時の回復を合わせて実装する。

## 共有契約

identityはowner、chat、week、conversationで固定し、shared revisionはUI revision / Fact Graph revisionとは別に管理する。Firestoreの `weekly_planning_conversations/{uid}/sessions/{chatId}.{weekStartDate}` に、version付きcore/UI一組を保存する。正常なpayloadが700 KiBを超えたら切り捨てず拒否する。未知のcapability、不正なowner/week/conversation、未完了turn/approval/recoveryは現在のcodecと境界検証で拒否する。

書込は読んだshared revisionに対するcompare-and-setである。競合時に更新日時の新しい方を採用せず、ローカルworkingと取得したremoteを両方保持し、そのscopeの自動flushを止める。端末内の変更にもgenerationを持たせ、古いeditorが別のlocal transactionを上書きすることを拒否する。未承認の予定を同期しただけで保存権限へ昇格させない。

送信前にoperation ID、base revision、payloadを一つのIndexedDB recordに確定する。通信失敗・応答消失後は同じoperationを再使用する。送信中の新しいlocal editは古い応答で消さず、次の送信待ちとして残す。IndexedDBの個々のrequest成功ではなくtransaction completeを待ち、abortは成功として返さない。

Firestore Rulesが同時更新を `ABORTED` より先に `permission-denied` として拒否することを実エミュレータで再現した。adapterは本人権限のserver readを一度だけ行い、revisionが実際に変わった場合だけconflictとして返す。同じrevisionや読取不能は元のエラー扱いとし、writeの無条件再試行、Rulesの緩和、別資格情報での再試行はしない。

明示削除はpayloadを空にしたtombstoneとしてrevisionを進める。古いoffline replicaによる復活はRulesとtransactionの両方で拒否する。本人以外の読取、同意前の読取・書込、退会開始後の読取・書込を許可しない。退会Workerは本文とtombstoneを含む所有sessionsを削除し、ブラウザー側の退会処理はIndexedDBの対象ownerだけを削除する。

## 確認済みの境界

同期state machineと実VNext payload readerの単体検証は14件成功。別々のFirebase Appとして同じアカウントへログインする実Auth / Firestoreエミュレータでは、復元、同一operation再送、同時更新、別owner拒否、直接の古いrevision書込拒否、tombstone、同意・退会境界を検査した。既存の実Worker退会試験にも新しいconversation collectionをseedし、別ownerを保持したまま完全削除されることを確認した。合計7件成功。本番のアカウントやデータは使っていない。

`tests/e2e/conversation-sync-storage.spec.mjs` は実ブラウザーのnative IndexedDBを使う。offline→reload→reconnectの同一operation保持、二つのconnectionのgeneration競合、transaction abort時の旧値保持、owner限定削除を検査し、ChromiumとWebKitで計8件成功した。SDKやIndexedDBのmock成功を、製品画面のE2E成功とは扱わない。専用configは他のアプリserverや有料APIを起動しない。

## 残る統合条件

本番hookには、保存されたcore/UI一組のhydrateとchat indexへの反映、安定したaccepted stateのoutboxへの接続、online復帰時の再送、dirty/conflict/errorの表示が必要である。複数tabが同時に編集した際は、拒否された側のlive stateを失わず回復できるUIも必要になる。現在のlocalStorageを書き続けながらIndexedDBを別の正本として付け足す実装にはしない。移行と途中失敗、owner切替、チャット削除、週切替、古いpreviewの承認拒否を実hookで確認する。

現在のプライバシー説明は、診断用会話記録の仮識別子・マスキング・180日保持を説明している。本人の会話復元用storeはそれとは別の責務である。自動uploadを配線する前に、本人向け復元データの説明・同意と保存期間を明確化し、期限切れ時の本文消去と古い端末からの復活防止を実装する。既存の診断同意だけでこの未接続storeの本番利用を完了扱いにしない。

Rules / index / Workerの本番deployとreadback、実アプリの二つのブラウザーcontextによる会話→別端末復元→同時訂正→offline→再接続のE2Eは未実施。本変更を本番同期完成としてリリースしない。過去のV5専用graph復元設計は現在のruntimeの実装指示として再利用しない。

## 全体検証の結果（2026-11-07、同一の実装・テスト内容）

`DEV_LAN_HOST=127.0.0.1 npm run verify` はfreshなapp/Worker型検査を通過した後、全体testでexit 1となった。結果は1,186 files / 13,127 tests passed、10 files / 13 tests failed、15 expected fail、134 skipped、1 todo。13失敗のうち11件は既存の5秒・10秒・30秒制限によるtimeout、2件は同じ全体実行内でのApp/provider-boundaryのassertion失敗である。今回の同期専用テストは成功したが、全体一括成功とは記録しない。

失敗した10ファイルはbase `67ea8b5c` とbyte同一と確認した。判定・timeout・テスト内容を変えず、同じ10ファイルだけ `--maxWorkers=2` で再実行すると201 tests / 10 filesがすべて成功、exit 0だった。負荷・並列実行との関係を示す結果ではあるが、元の全体実行の失敗を消すものではない。成功済みの全1,214ファイルは重複実行していない。独立に実行したproduction buildはexit 0、44.44秒。

Node v24.22.1、Vitest 5.0.5、TypeScript 5.9.3、Firebase 12.14.0。rootのインストール済み223 lock entriesは全件一致した。証拠はworktree内のignored `artifacts/issue47-conversation-sync/` に保存する。これらは新しい同期基盤と既存コードの検証であり、未接続の製品UI、実iPhone、GitHub CI、本番deploy/readbackの証明ではない。
