# #978 — V5 回帰の VNext 移管

Status: active
Owner: Issue [#978](https://github.com/kame447/StudyPlanner/issues/978)
Current branch: `test/issue978-v5-regression-vnext-2`, base `351137f0`（前単位は下記PR #1010）

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
| #911/#912 rate×量とtotal/別単位scope | 既存Projection `surfaces a rate and a total that disagree`、ShadowComparison、provider `rate-total-conflict` / `independent-scope`。 | **追加検証済み**: WorkIdentity suiteで8×5とtotal60を保持して質問、明示total40への訂正/旧rate取消によるtotal60保持で解消。別単位scopeは上記3選択。既存実API結果の個別再利用照合は未完。 |
| #918 受理時clock固定 | 既存Transactionのmulti-week weekday/relative date固定、Sessionの後日V5移行。DateOracleは受理後の絶対日を検査する。 | **追加検証済み**: Continuity suiteで11/2に受理した相対窓を11/3のWorker再開でも同じ絶対日として保持。 |
| #461 「明日ではなく今日」 | 既存planning-windowの明示patch/atomic staging。 | **追加検証済み**: Continuity suiteで明日→今日のwindow patch、必要な作業量の質問・task保持。不正refの初回/1回修復はgraph不変。両経路を翌日再開しても受理済日付を動かさず候補/preview0。 |
| #335 / D5 / C20 / A群 | 移管コメントのケースID・turn、既存provider/会話oraclesを再利用する。旧JEV live-negativeは5発話であり旧表の3行と異なる。 | **D5の型付き境界を追加検証済み**: `durableVNextD5Regression.integration.test.ts` が5発話の独立Math/English・総時間/単位時間・approximate・複合deadline・未承認preview0を検査。現行実モデルの解釈、C20/A全行と旧security反例の個別証拠は引き続き照合対象。旧コア比較や総数49/49を個別合格へ流用しない。 |
| C20 `past-progress-observed-pace` /1、`timebox-only-work` /1 | 既存Projectionのobserved paceと時間単位workload。 | Worker対応を `durableVNextV5Effort.integration.test.ts` に追加。完了10ページ/実測80分から残り5ページだけ40分とし、過去80分を将来の総時間へ流用しない。30分workloadは追加rateなしで30分とし、見積質問・候補/previewを作らない。合成意味出力を使う境界検証であり、実モデルの日本語読取の合格とはしない。 |

## 検証と次の手順

base799d89a3上の未commit作業ツリーで、DateOracle＋比較fixtureのfocused **37pass**（実API28件は既存opt-in skip）、Worker focused **8pass**。app+Worker typecheck（Worker型の再生成を含む）は成功。local full verify/E2E/実モデルは実行せず、親がexact headのCIを担当する。

第1単位はcommit `8edc29c2` / [PR #1010](https://github.com/kame447/StudyPlanner/pull/1010)。その上で `durableVNextV5Correction.integration.test.ts` の **4pass**（節順2例・schema回復2例）、app+Worker typecheck再成功。これも合成応答であり実モデル読取の成功とは区別する。

第2単位はcommit `a5820264`。その上の `durableVNextV5WorkIdentity.integration.test.ts` は **5pass**（作業の区別3例、見積衝突の回復2例）、app+Worker typecheck成功。初回の合成option応答にschema外のquestionKeyを付けたharness不整合を、実schemaのoptionId/minutes/perへ訂正した。質問が残る期待へ弱めていない。

第3単位はcommit `1245dd12`。その上の `durableVNextV5Continuity.integration.test.ts` は **4pass**（明示残量の保持/取消2例、日付窓訂正/不正ref2例）。既存の成功済みapp/Worker型検査の対象コード・型生成入力に差分はなく、その検証を継承する。追加Worker testは実行で検査した。

Continuityは`b5ba8496`、D5の5passは`daa090b1`で同PRへ統合。D5は条件付きの型付き読取をWorkerへ流す検証であり、全言い換えの意味読取の保証ではない。時間未定のMathはgraphと質問へ残し、配置可能なworkからは除外するという既存の境界を検査する。

CI `42345564448`（1245dd12）は有効な依存境界テスト1件が失敗した。新規評価helperのStable V5 graph型の直接importが原因で、既存の公開VNext境界経由へ修正した。isolation test/allowlistは変更せず、同gate＋DateOracleの9tests、全変更のfocused 8files64pass、app/Worker型検査を再確認。flake/環境原因へ読み替えない。

初回の失敗は評価側のrangeのfield名、および旧除外ケースを前提とするテストを分類・修正した。Workerのpreview assertionも実在するcheckpointのpreviewを検査する形へ訂正し、候補0という独立条件を保持した。過去モデルの意味欠落を修正したとは扱わない。

親の指示により新規のテスト単位追加を区切り、#1010の必須CI修復・exact-head gate確認を優先する。#996の既存実モデルrunは完了後に入力/ケース/差分を確認してAPI0の再採点候補とする。#996候補はprompt/schema/transactionも異なるため、そのrunを旧#1010 headの直接実モデル証拠とはしない。#978全体の未検証範囲はOpenのまま保持する。

次単位はmain `351137f0` 上のC20未対応2ケースのみ。`durableVNextV5Effort.integration.test.ts` のfocused **2pass**（`--maxWorkers=2`）で、実測80分を完了10ページへbindしたまま将来の5ページを40分へ見積もること、および時間単位のtarget30分を追加rateなしで30分とすることを確認した。Workerのschema/transaction/checkpointを通し、質問・未承認候補/previewなしも検査する。初回は公開wireに存在しないsession内部のoutcome/questionを参照したharness不整合を修正した。型検査・full verify・CI/E2Eは親が担当する。これは合成応答の境界検証であり、実モデル読取やC20全体の完了宣言ではない。
