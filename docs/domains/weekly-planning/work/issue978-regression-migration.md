# #978 — V5 回帰の VNext 移管

Status: active
Owner: Issue [#978](https://github.com/kame447/StudyPlanner/issues/978)
Current branch: `test/issue978-a66-worker-evidence`, base `856dbe11fd4a34c24fbe3d6f79d07b109152e176`。Git/GitHub更新と最終CIは親が担当する。下記の古い単位の結果は各当時のheadに限る。

週間実績の新機能は #973 で完了した。[移管コメント](https://github.com/kame447/StudyPlanner/issues/978#issuecomment-6702890002) が移管ケースの正本。本記録はテスト実装と残る境界を対応付ける。旧 V5 の mutation pipeline や比較専用 live gate は本番へ戻さない。

## 最初の実装単位

従来除外されていた計画窓2ターン・繰返し1ターン・固定予定2ターンを評価対象へ戻し、日付未検査だった完了訂正3ターンも検査する。

- `evals/vnextRealApiConversations.ts` は同じ発話・ケースIDを保持する。申し出のない「うん」を登録承認とする旧oracleは、2026-11-01の判断と当時の表示文脈に沿って訂正する。
- `evals/vnextRealApiDateOracle.ts` は評価専用。V5/VNext両観測runnerが同じ受理済みgraphを検査し、既存の日付resolverで日付窓・作業日・繰返し開始日を解決する。一般のtemporal完全一致を外すケースでも、必要な日付の意味はこのoracleで必ず検査する。
- 曖昧な日付を決定論コードが補わない。開始境界のない旧モデル応答はoracle失敗のまま、Workerは候補・保存権限を作らない。
- プロンプト、production診断/trace、checkpoint schema、Firestore rulesに変更なし。追加の評価情報は合成データの評価artifactだけが対象であり、production trace項目を増やす変更ではない。

パスの `evals/` / `vnext/` は `src/features/weeklyPlanning/` 配下。Worker testは `workers/ai-proxy/src/durableTurns/durableVNextV5Regression.integration.test.ts`。

## ケース別の対応と残件

「既存」は実装/テストの対応先であり、現在の日本語を実モデルが正しく読むという認定ではない。「追加検証済み」は本単位の合成応答を使う決定論テストの結果。

| 元ケース | 決定論の対応先 | Worker / 残る意味読取証拠 |
| --- | --- | --- |
| X0 `issue881-final-b-deadline-at-13/1`、`issue881-final-c-corrected-completion/1` | DateOracle `requires the stated planning day`。相対/絶対の同義表現を受理し、欠落/別日は拒否。 | **追加検証済み**: Workerのtomorrow/絶対日2例。作業不明なのでpreview/candidatesなし。 |
| X0 final-c /2,/3,/4 | DateOracle `accepts the same stated day` / `rejects missing, wrong-day and wrong-owner bounds`。各turnがworkDateを要求。 | **追加検証済み**: Workerで完了10→12、残り8・64分、独立した日付/単位時間の保持、checkpoint再開。元の各日本語の現行モデル読取は未実施。 |
| X0 `recurrence-out-of-vnext-scope/1` | DateOracle `accepts the next-week start`。weekly/月曜と開始境界の両方を要求。元IDは証拠との対応用に保持。 | **追加検証済み**: Workerでearliest_start/計画窓の2正例と開始欠落の負例。旧rep3の失敗を合格へ変更していない。 |
| X0 `fixed-event-yes-after-rendered-offer/1,/2` | 登録依頼false・候補0、busy区間は既存の固定予定oracleで検査。明示登録2正例も維持。 | **追加検証済み**: busy共有→checkpoint再開→相づちの2turnでbusyを保持し、task/candidate/previewなし。 |
| #882 completed/remaining/同turn見積訂正 | 既存Transaction `C12 and explicit R8` / `R8 + E60`、Projection `binds a same-turn quantity and total correction`、providerシナリオ `882-c12-derived-r8` / `882-iter4-explicit-r8` / `compound-r8-e60-1,2`。 | **追加検証済み**: Workerの10→12と不正参照対照。Correction suiteで明示R8枚＋E60分を節順2通りとも最終8枚へbindし、候補/保存権限0。 |
| #904 明示日付/期限/schema回復 | 既存Transactionの無効temporal/相対日、FocusedRecovery統合、providerシナリオ `explicit-date` / `deadline-tomorrow-1300`。 | **追加検証済み**: Correction suiteで初回schema不正→1回修復成功、および修復も不正→graph保持→次turn成功。どちらも明日13:00を受理時計の8/27終了期限として保持し、独立作業/見積は不変。 |
| #905/#907 「残り45分」と独立作業 | 既存Projection `never silently drops or double-counts other-basis work`、providerシナリオ `independent-scope` / `native-45-minute`。 | **追加検証済み**: WorkIdentity suiteで別作業125分、同一作業の45分保持/10ページ保持80分の3選択を、提示された型付きoption→Workerの回答bindで確認。元の日本語の現行モデル読取は未実施。 |
| #906/#907 blocking質問→対象付き訂正/関係明示 | 既存Projectionの矛盾選択/owner同一性、StageA3の反復質問と選択、provider `option-answer`。 | **追加検証済み**: 完了値の対象付き訂正、およびsame_or_distinct_workの全3選択で質問閉鎖、保存権限なし。|
| #908 再解釈による値変更/独立節消失 | 既存Providerの999改変を含むbounded repair、Transactionの独立節/ownership/stale/cross-task拒否。 | **追加検証済み**: Workerの不正参照を初回/1回修復とも拒否しgraph全体を保持。元モデルの12→999や別対象移動の読取は別途照合。 |
| #909/#919 明示残量・独立見積の保持 | 既存TransactionのC12/R8、Projectionの旧見積不再利用/observed pace、provider `explicit-r7-retained` / `observed-pace` / `custom-unit-change` / `custom-page-preservation`。 | **追加検証済み**: Continuity suiteでtotal無しC10/R7→C12でもR7とtotal無しを維持、total20ありC13/R7→C12は矛盾を質問。明示R7取消→翌日再開でもR7は復活せず、totalがある場合だけ残り8を導出する。rate/date保持・rate取消後の衝突解消も他suiteで確認。 |
| C20 `omitted-effort-answer` /1、`paraphrase-restatement-no-duplicate` /1,/2 | 省略時の必要見積質問と既存事実への再表明。 | `durableVNextV5Restatement.integration.test.ts` の **2pass**。前者は/2の「分からない」も対照とし、checkpoint再開後も残り8問・未知の見積・提示質問を保持する。後者は既存量/単位時間への同値patchを通し、有効な作業/見積を各1件、10ページ・50分に保つ。いずれも候補/previewなし。型付き意味出力の条件下のWorker検証であり、実モデルの省略・言い換え認識を保証しない。 |
| #911/#912 rate×量とtotal/別単位scope | 既存Projection `surfaces a rate and a total that disagree`、ShadowComparison、provider `rate-total-conflict` / `independent-scope`。 | **追加検証済み**: WorkIdentity suiteで8×5とtotal60を保持して質問、明示total40への訂正/旧rate取消によるtotal60保持で解消。別単位scopeは上記3選択。既存実API結果の個別再利用照合は未完。 |
| C20 `fixed-event-registration-negated` /1、`fixed-event-yes-without-registration-offer` /1,/2 | 登録権限のないbusyと既存学習作業の保持。 | `durableVNextV5BusyBoundary.integration.test.ts` の **2pass**。前者は受理可能なnon_study＋fixed_intervalの意味出力を使い、11/3の16:00–17:30を配置側の占有区間へ保持、登録候補/previewなし。後者は20分作業をcheckpointから保持し、busy＋相づちでも登録権限を作らず、配置側へ同じbusy時間を渡す。任意質問の表示や実モデルの拒否/相づち認識はこの単位の合格へ含めない。 |
| #918 受理時clock固定 | 既存Transactionのmulti-week weekday/relative date固定、Sessionの後日V5移行。DateOracleは受理後の絶対日を検査する。 | **追加検証済み**: Continuity suiteで11/2に受理した相対窓を11/3のWorker再開でも同じ絶対日として保持。 |
| C20 `issue881-final-b-deadline-at-13` /2 | 受理済みの日付窓の後で作業名だけが加わる段階。 | `durableVNextV5TaskIntake.integration.test.ts` の **1pass**。/1の「明日の予定」を8/27へ固定したcheckpointから、逐語タイトル「研究室のレポート」を追加しても窓を保持する。量/見積/候補/previewを補わず、そのtaskの作業量の質問を提示する。合成意味出力によるWorker境界検証であり、後続の期限turnや実モデル認識の証明ではない。 |
| #461 「明日ではなく今日」 | 既存planning-windowの明示patch/atomic staging。 | **追加検証済み**: Continuity suiteで明日→今日のwindow patch、必要な作業量の質問・task保持。不正refの初回/1回修復はgraph不変。両経路を翌日再開しても受理済日付を動かさず候補/preview0。 |
| C20 `independent-explicit-remaining` /1、`d5-positive-per-unit-rate` /2 | 明示残量の単位時間と、提示された対象への明示的な単位時間回答。 | `durableVNextV5ExplicitRate.integration.test.ts` の **2pass**。前者は総量/完了量を補わず残り8ページ×5分=40分。後者は/1の質問からcheckpointを再開し、focusedの15分/問を数学20問だけへbind、数学300分・英語45分を保持。nativeは初回1件のみ、回答はfocused1件。全タイトルは発話の逐語部分。いずれも候補/previewなしの型付き応答検証であり、実モデル認識は別証拠。 |
| #335 / D5 / C20 / A群 | 移管コメントのケースID・turn、既存provider/会話oraclesを再利用する。旧JEV live-negativeは5発話であり旧表の3行と異なる。 | **D5の型付き境界を追加検証済み**: `durableVNextD5Regression.integration.test.ts` が5発話の独立Math/English・総時間/単位時間・approximate・複合deadline・未承認preview0を検査。現行実モデルの解釈、C20/A全行と旧security反例の個別証拠は引き続き照合対象。旧コア比較や総数49/49を個別合格へ流用しない。 |
| C20 `past-progress-observed-pace` /1、`timebox-only-work` /1 | 既存Projectionのobserved paceと時間単位workload。 | Worker対応を `durableVNextV5Effort.integration.test.ts` に追加。完了10ページ/実測80分から残り5ページだけ40分とし、過去80分を将来の総時間へ流用しない。30分workloadは追加rateなしで30分とし、見積質問・候補/previewを作らない。合成意味出力を使う境界検証であり、実モデルの日本語読取の合格とはしない。 |
| C20 `optional-invitation-busy-decline-reopen` /1,/2,/3、`optional-decline-does-not-close-required-effort` /1,/2 | 既存Sessionの任意追加拒否と必須質問の区別。 | `durableVNextV5Invitation.integration.test.ts` の **2pass**。busy共有→任意追加拒否→checkpoint再開で質問を閉じたまま11/3の16:00–17:30を保持する一方、数学10問の必須見積は同じ拒否でも保持・提示する。両経路とも候補/previewなし。合成意味出力によるWorker境界検証であり、実モデル読取や同ケース/4の再開・全C20完了の証明ではない。 |

## A66 公開操作の移管（2026-11-08）

出典は移管コメントが参照する `DeftPauling-coverage-matrix.md` §2、歴史的head `652418e8` / base `cc1cbce6`。以下のA01–A66はその**表の行順**であり、66個の独立した意味解析ケースや66個の新規Workerテストを意味しない。旧表に行番号がない重複行は列挙順を保ち、推定の行番号を付けない。旧JEVの:669は5発話のループで、:738/:766はmock専用である。

`WorkerOps` = `workers/ai-proxy/src/durableTurns/durableVNextPublicOperations.integration.test.tsx`。本番の公開hook → durable client → 実`DurableTurnJob`/`executeDurableVNextJob` → VNext interpreter/renderer → controller → 共通承認applicationを通す。HTTP搬送・認証・モデル出力・保存先は合成で、保存先には実memory repositoryを使う。ブラウザ側のAI呼出portは例外にしてWorkerへの経路を確認する。これは実API、実Firestore、DOM描画やタッチ操作の証拠ではない。

`Worker` = その行の機械状態・権限を実Workerで検査する対応先。`UI保持` = Workerが所有しない表示/操作条件で、記載の既存ブラウザspecが所有する。UI保持をWorker通過・現headのE2E成功へ読み替えない。既存のStable V5専用specを本番VNextの証拠として使わない。

| 行 | 旧specとbase行 | VNextの対応先・残るUI境界 |
| --- | --- | --- |
| A01 | weekly-real-application:70 | WorkerOps `A01/A14`：順序と重複送信。 |
| A02 | weekly-real-application:91 | WorkerOps `A02/A03`：cancel後の遅延結果を拒否。 |
| A03 | weekly-real-application:129 | WorkerOps `A02/A03`：取消後の次turnは受理済checkpointから開始。 |
| A04 | weekly-real-application:150 | WorkerOps `A04/A05/A28`：detach中にWorker完了、再接続で1応答。ダイアログclose操作はUI保持。 |
| A05 | weekly-real-application:165 | 同test：previewをreload後も保持、POST/provider再実行0。 |
| A06 | weekly-real-application:181 | WorkerOps `A06`：履歴だけclearしpreviewを保持。 |
| A07 | weekly-real-application:194 | WorkerOps `A07`：週reset後も旧chatの全履歴・保存済Planを保持。 |
| A08 | weekly-real-application:222 | WorkerOps `A08/A09/A10/A11-A13/A17-A23`：明示昇格だけでは保存せず、Save後1件。 |
| A09 | weekly-real-application:236 | 同test：reload後の未承認previewを保持。 |
| A10 | weekly-real-application:248 | 同test：復元したpreviewの出所で承認。stale previewは別の負例testで拒否。 |
| A11 | weekly-real-approval-races:48 | 同test：保存待ち中の第二承認を拒否、Plan書込1回。 |
| A12 | weekly-real-approval-races:63 | 同test：同時承認と完了後の再承認で追加書込0。イベント配線はUI保持。 |
| A13 | weekly-real-approval-races:84 | 同test：reload後も同じ完了operation、再保存0。保存中のclose/reopen UIはUI保持。 |
| A14 | weekly-real-concurrency:19 | WorkerOps `A01/A14`：送信中の第二submitを拒否、POST1件。 |
| A15 | weekly-real-failure-recovery:36 | WorkerOps `A15`：Worker provider障害後にpendingを解除、次turn成功。 |
| A16 | weekly-real-failure-recovery:56 | WorkerOps `A16`：部分保存→reload→同operation再試行、既保存分を再書込しない。 |
| A17 | weekly-preview-approval:72 | WorkerOps 承認test：preview直接承認では保存0。 |
| A18 | weekly-preview-approval:84 | 同test：昇格とSaveを分離。ボタンDOMはUI保持。 |
| A19 | weekly-preview-approval:93 | 同test：明示Save後にだけ保存。キー操作はUI保持。 |
| A20 | weekly-preview-approval:103 | 同test：昇格時保存0。pointer操作はUI保持。 |
| A21 | weekly-preview-approval:127 | 同test：二重保存0。フォーカス/keyboardはUI保持。 |
| A22 | weekly-preview-approval:143 | 同test：承認境界。WebKit/mobile条件とtouchは既存specのUI保持。 |
| A23 | weekly-preview-approval:159 | 同test：Save後reloadも書込1件。画面操作はUI保持。 |
| A24 | weekly-session-duration-ack:107 | WorkerOps `A24/A25`：60分preview→明示Save→reload、実Planの所要時間60分・書込1回。 |
| A25 | weekly-session-duration-ack:156 | 同test：不正な所要時間を1回修復しても無効ならpreview0、次の正常turnで回復。 |
| A26 | weekly-real-image-ownership:14 | UI保持：画像URL/添付の所有。`weeklyPlanningVNextLocalRuntime.integration.test.tsx` のattachment evidence正例、WorkerOps owner fenceが別の所有境界を検査する。画像DOMの代替ではない。 |
| A27 | weekly-real-image-ownership:30 | 同じUI所有境界。WorkerOps owner fenceは旧ownerの遅延結果を新ownerへ公開しない。 |
| A28 | weekly-durable-return:18 | WorkerOps `A04/A05/A28`。既存`durableVNextReload.integration.test.tsx`も実job完了からの復元を所有。 |
| A29 | weekly-unreadable-storage-retention:59 | UI保持：同specのVNext core/ui未知形式sentinelをbyte同一で保持。Worker未送信のstorage/read境界であり、正常Worker応答を作るテストへ変換しない。 |
| A30 | weekly-rendering-security:18 | UI保持：HTML/スクリプトを実行しないDOM境界。Worker JSON成功だけでXSS安全としない。 |
| A31 | weekly-rendering-security:47 | 同じDOM境界。実Worker wireのforeign owner/checkpoint拒否は`durableVNextTurn.test.ts`が別に検査。 |
| A32 | weekly-keyboard 行番号なし1 | UI保持：IME確定で送信しない。WorkerOps送信回数はIME配線を証明しない。 |
| A33 | weekly-keyboard 行番号なし2 | UI保持：Shift+Enter/desktop Enter。 |
| A34 | weekly-keyboard 行番号なし3 | UI保持：Ctrl/Cmd+Enterとmobile編集。 |
| A35 | weekly-keyboard 行番号なし4 | cancel後の再送可能性はWorkerOps `A02/A03`、composerのfocusはUI保持。 |
| A36 | weekly-keyboard:118 | UI保持：touch Enterを改行として保持。 |
| A37 | ai-planning-surface:139 | UI保持：homeから会話画面へ入る。providerを呼ばない入口操作。 |
| A38 | ai-planning-surface:261 | UI保持：multiweek集計/paging/mobile昇格。WorkerOps承認testは昇格後の保存境界を検査し、5週表示の代替とはしない。 |
| A39 | ai-planning-surface:306 | UI保持：月間候補を5ページで保持。 |
| A40 | ai-planning-surface:451 | UI保持：desktop会話幅とdraft/history。WorkerOps `A07`は履歴状態の保持。 |
| A41 | ai-planning-surface:492 | UI保持：viewport内のaction/detail scroll。 |
| A42 | ai-planning-surface:571 | UI保持：dark/compactの可読性。 |
| A43 | ai-planning-preview-interaction 行番号なし1 | UI保持：390pxで見積/余白を表示しoverflowしない。 |
| A44 | ai-planning-preview-interaction 行番号なし2 | UI保持：7日preview/tap-to-day。 |
| A45 | ai-planning-preview-interaction 行番号なし3 | UI保持：bottom sheet/swipe dismissal。 |
| A46 | ai-planning-preview-interaction 行番号なし4 | UI保持：背景scroll lock/overlay。 |
| A47 | ai-planning-preview-item-removal 行番号なし1 | WorkerOps `A47-A52`：削除した候補は昇格/保存対象に入らない。削除ボタンはUI保持。 |
| A48 | ai-planning-preview-item-removal 行番号なし2 | 同testは候補削除を検査。昇格済draftの削除は既存reducer/browser specが所有し、その経路を同testの合格に含めない。 |
| A49 | ai-planning-preview-item-removal 行番号なし3 | UI保持：storage失敗時のoperable retry/空chat。`weeklyPlanningVNextLocalRuntime.integration.test.tsx`がcommit失敗時rollback/再試行を別に検査。 |
| A50 | ai-planning-preview-item-removal 行番号なし4 | WorkerOps削除後saveは同じ状態条件。discarded animation frameはUI保持。 |
| A51 | ai-planning-preview-item-removal 行番号なし5 | UI保持：day previewのtouch long press。 |
| A52 | ai-planning-preview-item-removal 行番号なし6 | UI保持：overview long press/drag。 |
| A53 | ai-planning-starter-prompts:14 | UI保持：starter表示。`weeklyPlanningVNextLocalRuntime.integration.test.tsx`のregistered-target starter正例を維持。 |
| A54 | ai-planning-attachment-mobile:111 | UI保持：mobile添付layout/入力保持。画像内容の意味読取を新たに認定しない。 |
| A55 | ai-planning-temporal-work-semantics:206 | `weeklyPlanningVNextSchedulerGraph.test.ts`：型付き窓を配置器へ渡す境界。hard window/gapの実表示はUI保持、Worker全経路の同一gapテストとは数えない。 |
| A56 | ai-planning-temporal-work-semantics:220 | 同じ配置責務。one-sitting非分割のブラウザspecを保持。 |
| A57 | ai-planning-temporal-work-semantics:226 | `durableVNextV5Regression.integration.test.ts`の登録/可動作業、`durableVNextV5BusyBoundary.integration.test.ts`。実画面はUI保持。 |
| A58 | fixed-event-registration.incident 行番号なし | 同Worker tests：busyだけでは登録権限を作らず、明示登録の正例を保持。incident UI specは保持。 |
| A59 | ai-planning-jev-first-authority:405 | WorkerOps承認/reload/stale負例＋`durableVNextV5Correction.integration.test.ts`。旧V5 tier選択を復活させない。 |
| A60 | ai-planning-jev-first-authority:459 | `durableVNextV5ExplicitRate.integration.test.ts`：提示対象付き15分/問、数学300分・英語45分を保持。 |
| A61 | ai-planning-jev-first-authority:524 | 同Workerのfocused回答＋WorkerOps訂正/保存/reload。旧rendererの「grounded ACK」完全一致は意味oracleにしない。 |
| A62 | ai-planning-jev-first-authority:669 | `durableVNextD5Regression.integration.test.ts`：5発話を独立Math/English・deadline・概算・未承認0で検査。実モデル証拠は次節。 |
| A63 | ai-planning-jev-first-authority:738 | WorkerOps `A02/A03`：cancelled late choiceの結果を破棄。旧mock専用。 |
| A64 | ai-planning-jev-first-authority:766 | `durableVNextTurn.test.ts`のrenderer障害でも受理済previewを保持＋WorkerOps承認。誤った表示文を機械状態へ戻す旧JEV経路を復活させない。 |
| A65 | weekly-planning-module-recovery:44 | `weeklyPlanningVNextPrepareTurn.integration.test.tsx`：module失敗でprovider/解釈前に拒否。MIME障害/明示reload/入力保持はUI保持。 |
| A66 | weekly-planning-module-recovery:97 | 同preflight＋既存module recovery browser spec：sessionStorage quota時のeditable input/image保持。Worker送信前なので正常Worker応答で代替しない。 |

A66の対応表には空欄を残さず、UI専有行とWorker/state行の検査強度を区別した。ブラウザの66行をWorkerテスト66件として数え直したり、未実行の現head browser gateを成功としたりしない。追加unitの結果と現行実モデルの結果を下記へ記録してからclose判断する。

base `856dbe11` ＋この変更で `npx vitest run --maxWorkers=2 src/features/weeklyPlanning/vnext workers/ai-proxy/src` は **2735pass / 39意図したopt-in skip / 0fail**（追加のWorkerOpsは12/12pass）。`npm run typecheck` はapp＋Workerともexit0、`git diff --check` 成功。Node v24.22.1 / Vitest5.0.5、lock SHA256 `529b5285a7ecfbc9b8da8176f9e6811fd3ee3c398e3b1d9db6c134a10faed122`、自分の既存installを使った。最初のtest配置はWorker専用型をappへ引き込むため型検査失敗し、既存Worker統合testと同じ場所へ移して解決した。tsconfigや既存assertionは変更していない。最終配置で全体を再確認済み。full verify / Browser / CIは親のexact commitで実行する。

## 現行実モデルの証拠（2026-11-08）

親が [run 42401398186](https://github.com/kame447/StudyPlanner/actions/runs/42401398186) をmain `856dbe11fd4a34c24fbe3d6f79d07b109152e176`、profile `vnext`、repetitions `3` で開始した。workflowのmodelは`gpt-6-luna`。既存28会話を変更せず、C20の20対象turnとJEV5発話の対象turnを各反復の`vnext-native.json`から抽出する。job成功や比較全体の件数で個別turnを合格にしない。`not_reached`、error、skipはPASSではない。

このprofileの比較会話はnative semantic/session経路の観測で、production focused解釈器・実Worker HTTP/Auth/Firestoreを通すものではない。D5のfocused回答の正式bindは別の決定論Workerテストが所有する。同profileの別provider suiteにはfocused観測も含まれるが、C20比較会話と混同しない。

3反復は完了。artifact `weekly-planning-real-api-1` = `13585773871`、`-2` = `13586313725`、`-3` = `13586153884`。各artifactのheadは上記mainと一致し、取得ZIPのSHA256をGitHub digestに独立照合した。provider smokeの応答modelも全反復`gpt-6-luna`。比較観測のraw-call captureにはHTTPのmodel/finish/usage envelopeがないため、それらを追加で確認したとはしない。

以下は各`vnext-comparison/vnext-native.json`のcase ID/turn、status、error、oracleDifferencesを照合した**実モデルPASS/FAIL**。全対象が到達・解釈成功し、受理済みで、承認前の保存0。C20の60観測とJEVの15観測には重複する対象があり、75個の独立ケースとは数えない。

| 対象 | case/turn | rep1 | rep2 | rep3 |
| --- | --- | --- | --- | --- |
| C01 | fixed-event-busy-information-only/1 | PASS | PASS | PASS |
| C02 | fixed-event-registration-negated/1 | PASS | PASS | PASS |
| C03 | fixed-event-yes-without-registration-offer/1 | PASS | PASS | PASS |
| C04 | fixed-event-yes-without-registration-offer/2 | PASS | PASS | PASS |
| C05 | omitted-effort-answer/1 | PASS | PASS | PASS |
| C06 | paraphrase-restatement-no-duplicate/1 | PASS | PASS | PASS |
| C07 | paraphrase-restatement-no-duplicate/2 | PASS | PASS | PASS |
| C08 | past-progress-observed-pace/1 | PASS | PASS | PASS |
| C09 | independent-explicit-remaining/1 | PASS | PASS | PASS |
| C10 | timebox-only-work/1 | PASS | PASS | PASS |
| C11 | issue881-final-b-deadline-at-13/2 | PASS | PASS | PASS |
| C12 | optional-invitation-busy-decline-reopen/1 | PASS | PASS | PASS |
| C13 | optional-invitation-busy-decline-reopen/2 | PASS | PASS | PASS |
| C14 | optional-invitation-busy-decline-reopen/3 | PASS | PASS | PASS |
| C15 | optional-decline-does-not-close-required-effort/1 | PASS | PASS | PASS |
| C16 | optional-decline-does-not-close-required-effort/2 | PASS | PASS | PASS |
| C17 | d5-negative-pages-only/2 | PASS | PASS | PASS |
| C18 | d5-negative-total-minutes/2 | PASS | PASS | PASS |
| C19 | d5-negative-approximate-rate/2 | PASS | PASS | PASS |
| C20 | d5-positive-per-unit-rate/2 | PASS | PASS | PASS |
| J01 | d5-negative-pages-only/2 | PASS | PASS | PASS |
| J02 | d5-negative-english-minutes/2 | PASS | PASS | PASS |
| J03 | d5-negative-total-minutes/2 | PASS | PASS | PASS |
| J04 | d5-negative-compound/2 | PASS | PASS | PASS |
| J05 | d5-negative-approximate-rate/2 | PASS | PASS | PASS |

close判断のため、同artifactのX0の8turnも個別照合した。final-b/1、final-c/1–4、fixed-event-yes-after-rendered-offer/1–2は各3/3PASS。**recurrence-out-of-vnext-scope/1はPASS/PASS/FAIL**であり、全体完了ではない。rep3 rawはweekly/weekday:mondayだけを返し、「来週から」のearliest_startとplanning_windowの両方が欠落した。受理graphのtemporalは空で、oracleは `recurrence start missing: 2026-11-09`。表示文には「来週から」があっても機械事実の代わりに使わない。候補・preview・保存は0のまま。

### 失敗の分類とclose判断

| 現在の反例 | 分類・根拠 | F / S / Pと処置 |
| --- | --- | --- |
| #978 X0 recurrence開始境界（rep3/3のうち1回） | モデルの意味欠落。rawにも受理graphにも開始が無く、oracleの別表現受理（earliest_startまたはwindow）でも救えない。古い除外・環境失敗ではない。 | 実利用F不明、S4、P未算定。1/3は条件付き観測率で本番頻度ではない。明示された開始境界の保持要求違反として**#978に残す**。同じ既知反例の新Issueは作らない。 |
| 別provider suite #1005 answer-plus-request（rep1のみ） | focused rawがeffort_answerだけを返し、独立の予定案作成依頼を落とす。40分は保持するがplanningIntent=unknown、preview0。rep2/3は作成依頼evidenceとpreviewを保持。 | F不明、S4、P未算定。明示依頼違反として既存#1005へ。C20/JEVの失敗へ混同せず、無関係なcode修正をこのtest単位に混ぜない。 |
| 別provider suite #868-6 compound-date-shared（rep1/2） | 日付は数学11/3を正しく保持。rawのrequest_event_registrationが空で、明示したゼミ登録候補だけ欠落。rep3は同じ時刻の登録候補を保持。transport障害や日付oracleの誤りではない。 | F不明、S4、P未算定。明示登録依頼違反として既存#868へ。未承認saveは全反復0。 |

workflowのrep1は2failed/94passed、rep2は1failed/95passed、rep3は96passed。**rep3のjob成功でもX0開始欠落は比較artifactに残る**ため、jobのgreenを意味oracleの全件合格にしない。比較native全54turnの結果は54/54、54/54、53/54で、上の個別行が正本。

X0の実Worker再生は `.handoff/978-recurrence-reproducer.patch`（合成観測だけの孤立RED、通常source差分に含めない）に保持。観測rawを変更せず実Workerへ渡すと1件FAILし、開始欠落oracleが再現する。同じWorker suiteの既存bound/window正例はgreenのまま。これは欠落したモデル出力から決定論コードに日付を捏造させる要求ではなく、修正後の意味読取は新しい実モデル応答で再検証する必要がある。

**結論: #978はOpen継続。** A66の会話コア責務は上記12test/66行対応、C20とJEVの今回対象の意味読取は未確認0。残る#978内の実証済み条件はX0 recurrenceの開始境界1件。親が意味読取修正のowner/範囲を決め、現行実モデルの同反例で確認する。別scopeの#1005/#868と共通UIの最終Browser/CIはそれぞれのownerが追跡し、このtest/doc差分の本番配信順序は追加しない。

## 過去の検証記録

base799d89a3上の未commit作業ツリーで、DateOracle＋比較fixtureのfocused **37pass**（実API28件は既存opt-in skip）、Worker focused **8pass**。app+Worker typecheck（Worker型の再生成を含む）は成功。local full verify/E2E/実モデルは実行せず、親がexact headのCIを担当する。

第1単位はcommit `8edc29c2` / [PR #1010](https://github.com/kame447/StudyPlanner/pull/1010)。その上で `durableVNextV5Correction.integration.test.ts` の **4pass**（節順2例・schema回復2例）、app+Worker typecheck再成功。これも合成応答であり実モデル読取の成功とは区別する。

第2単位はcommit `a5820264`。その上の `durableVNextV5WorkIdentity.integration.test.ts` は **5pass**（作業の区別3例、見積衝突の回復2例）、app+Worker typecheck成功。初回の合成option応答にschema外のquestionKeyを付けたharness不整合を、実schemaのoptionId/minutes/perへ訂正した。質問が残る期待へ弱めていない。

第3単位はcommit `1245dd12`。その上の `durableVNextV5Continuity.integration.test.ts` は **4pass**（明示残量の保持/取消2例、日付窓訂正/不正ref2例）。既存の成功済みapp/Worker型検査の対象コード・型生成入力に差分はなく、その検証を継承する。追加Worker testは実行で検査した。

Continuityは`b5ba8496`、D5の5passは`daa090b1`で同PRへ統合。D5は条件付きの型付き読取をWorkerへ流す検証であり、全言い換えの意味読取の保証ではない。時間未定のMathはgraphと質問へ残し、配置可能なworkからは除外するという既存の境界を検査する。

CI `42345564448`（1245dd12）は有効な依存境界テスト1件が失敗した。新規評価helperのStable V5 graph型の直接importが原因で、既存の公開VNext境界経由へ修正した。isolation test/allowlistは変更せず、同gate＋DateOracleの9tests、全変更のfocused 8files64pass、app/Worker型検査を再確認。flake/環境原因へ読み替えない。

初回の失敗は評価側のrangeのfield名、および旧除外ケースを前提とするテストを分類・修正した。Workerのpreview assertionも実在するcheckpointのpreviewを検査する形へ訂正し、候補0という独立条件を保持した。過去モデルの意味欠落を修正したとは扱わない。

親の指示により新規のテスト単位追加を区切り、#1010の必須CI修復・exact-head gate確認を優先する。#996の既存実モデルrunは完了後に入力/ケース/差分を確認してAPI0の再採点候補とする。#996候補はprompt/schema/transactionも異なるため、そのrunを旧#1010 headの直接実モデル証拠とはしない。#978全体の未検証範囲はOpenのまま保持する。

次単位はmain `351137f0` 上のC20未対応2ケースのみ。`durableVNextV5Effort.integration.test.ts` のfocused **2pass**（`--maxWorkers=2`）で、実測80分を完了10ページへbindしたまま将来の5ページを40分へ見積もること、および時間単位のtarget30分を追加rateなしで30分とすることを確認した。Workerのschema/transaction/checkpointを通し、質問・未承認候補/previewなしも検査する。初回は公開wireに存在しないsession内部のoutcome/questionを参照したharness不整合を修正した。型検査・full verify・CI/E2Eは親が担当する。これは合成応答の境界検証であり、実モデル読取やC20全体の完了宣言ではない。
