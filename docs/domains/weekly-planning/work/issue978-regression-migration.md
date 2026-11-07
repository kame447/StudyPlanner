# #978 — V5 回帰の VNext 移管

Status: active
Owner: Issue [#978](https://github.com/kame447/StudyPlanner/issues/978)
Branch: `test/issue978-v5-regression-vnext`, base `799d89a3`

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
| #882 completed/remaining/同turn見積訂正 | 既存Transaction `C12 and explicit R8` / `R8 + E60`、Projection `binds a same-turn quantity and total correction`、providerシナリオ `882-c12-derived-r8` / `882-iter4-explicit-r8` / `compound-r8-e60-1,2`。 | **追加検証済み**: Workerの10→12と不正参照対照。明示R8と同turn E60のWorker対応は次の単位。 |
| #904 明示日付/期限/schema回復 | 既存Transactionの無効temporal/相対日、FocusedRecovery統合、providerシナリオ `explicit-date` / `deadline-tomorrow-1300`。 | 日付窓は上記で追加検証済み。元の13:00期限・不正schema→回復のWorker正例/反例は未追加。 |
| #905/#907 「残り45分」と独立作業 | 既存Projection `never silently drops or double-counts other-basis work`、providerシナリオ `independent-scope` / `native-45-minute`。 | 同一/別scopeの各選択と日本語のWorker対応は未追加。 |
| #906/#907 blocking質問→対象付き訂正/関係明示 | 既存Projectionの矛盾選択/owner同一性、StageA3の反復質問と選択、provider `option-answer`。 | 完了値の対象付き訂正は追加検証済み。関係選択の元反例との対応は未完。 |
| #908 再解釈による値変更/独立節消失 | 既存Providerの999改変を含むbounded repair、Transactionの独立節/ownership/stale/cross-task拒否。 | **追加検証済み**: Workerの不正参照を初回/1回修復とも拒否しgraph全体を保持。元モデルの12→999や別対象移動の読取は別途照合。 |
| #909/#919 明示残量・独立見積の保持 | 既存TransactionのC12/R8、Projectionの旧見積不再利用/observed pace、provider `explicit-r7-retained` / `observed-pace` / `custom-unit-change` / `custom-page-preservation`。 | 訂正で独立したrate/date保持は追加検証済み。取消・旧残量/見積が予定へ戻らないWorker境界は未追加。 |
| #911/#912 rate×量とtotal/別単位scope | 既存Projection `surfaces a rate and a total that disagree`、ShadowComparison、provider `rate-total-conflict` / `independent-scope`。 | ケースID付きの既存#926実API証拠再利用とWorkerの正例/反例対応は未完。 |
| #918 受理時clock固定 | 既存Transactionのmulti-week weekday/relative date固定、Sessionの後日V5移行。DateOracleは受理後の絶対日を検査する。 | Worker checkpoint再開後に日付を保持する例を追加。別日の再開という元条件の固有証拠は既存テストと照合する。 |
| #461 「明日ではなく今日」 | 既存planning-windowの明示patch/atomic staging。 | 元日本語/訂正承認のWorker正例/反例は未追加。 |
| #335 / D5 / C20 / A群 | 移管コメントのケースID・turn、既存provider/会話oraclesを再利用する。旧JEV live-negativeは5発話であり旧表の3行と異なる。 | 通常VNextの権限/独立事実の境界へ対応付ける。旧コア比較のgreenや総数49/49を個別ケースの合格としない。 |

## 検証と次の手順

base799d89a3上の未commit作業ツリーで、DateOracle＋比較fixtureのfocused **37pass**（実API28件は既存opt-in skip）、Worker focused **8pass**。app+Worker typecheck（Worker型の再生成を含む）は成功。local full verify/E2E/実モデルは実行せず、親がexact headのCIを担当する。

初回の失敗は評価側のrangeのfield名、および旧除外ケースを前提とするテストを分類・修正した。Workerのpreview assertionも実在するcheckpointのpreviewを検査する形へ訂正し、候補0という独立条件を保持した。過去モデルの意味欠落を修正したとは扱わない。

次は#882の明示R8＋E60、#904の13:00/schema回復、#905の同一/別scopeから、未カバーのWorker正例/反例を最小単位で追加する。実モデルrunは親の予算・実行判断へ依頼する。全行の境界と結果が揃うまで#978全体の完了とはしない。
