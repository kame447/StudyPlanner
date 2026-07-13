# D3: メンター対話の相対制約・実行可能性・conversation eval を完成させる

Status: **open — D2 の後**

Priority: Medium。D2 で state-grounded dialogue が通常経路になった後、相対条件と計算結果に基づく相談を domain に接続し、自然さと安全性を同時に評価する。

本 task は [親設計 v4](../../architecture/weekly-planning-dialogue-architecture-v4.md) §4、§8、§9 の D3 である。

## 目的

次のロールプレイを、固定された応答文ではなく会話行為と domain 結果で評価可能にする。

- 既存の授業、バイト、固定予定を再入力させずに引用する。
- 「バイト終了後、帰宅10分の後に夕食」のような相対条件を候補として理解し、deterministic に時刻・busy interval へ展開する。
- 所要時間が不明なら「まず3時間と仮定して組みますか」と提案し、承認前は確定 state にしない。
- 週内に収まらないとき、required / available / unscheduled の計算結果を根拠に、優先順位または並行方針を相談する。
- すでに方針が揃えば preview を提案する。

## 実装方針

### 相対 constraint

AI interpreter は相対関係を typed candidate として返す。候補には参照 event、offset、対象 constraint、hardness、sourceText を含め、AI が具体日時や配置を最終決定しない。

adapter / validator は次を確認する。

- 参照 event が snapshot / state に一意に存在する。
- offset、duration、時刻表現が値域内である。
- 曖昧参照、循環参照、範囲外の日付は hard apply せず clarification または assumption proposal へ倒す。
- 相対候補が確定・承認されたときだけ reducer が domain constraint に変換する。

scheduler は正規化済み constraint だけを busy interval に変換する。相対表現の自然言語を scheduler に渡さない。

### feasibility consultation

scheduler diagnostics から presentation 用の deterministic feasibility summary を作る。AI はその summary が不足を示すときだけ discuss_feasibility を選べる。

応答では、未配置量、どの条件が容量を狭めているか、選択肢を説明できる。ただし AI は合計時間や空き時間を再計算せず、snapshot の数値を参照する。選択肢は「完了間近の科目を優先」「全分野を並行」「対象量を減らす」など、domain policy が許可したものだけにする。

### conversation evaluation と計測

docs/testing/weekly-planning-roleplay-test-plan.md に WP-DA-001 を追加し、次を deterministic assertion と rubric に分ける。

- state / command / diagnostic: 必須の厳密 assertion
- action、factRefs、question topics、assumption status: 必須の厳密 assertion
- 自然文: 敬体、再質問禁止、機械的 slot 質問禁止、根拠なしの事実禁止を rubric で評価

実モデル eval は通常テストから分離し、fixture、モデル設定、日時、既存予定を記録して再実行可能にする。call 数、token、p50 / p95 latency、fallback 率、action rejection 率を計測する。

## 対象ファイル

- intake command types、adapter、validator、reducer、reference resolution
- scheduling の constraint-to-busy-interval 境界
- dialogue snapshot / allowed actions / planner
- testFixtures、roleplay scenarios、roleplay test plan
- 実モデル eval 用の明示的な opt-in test または runner

D1 / D2 の契約を壊さず、保存、承認、scheduler 二系統統合、生活プロファイル永続化は対象外とする。

## 受け入れ条件

1. 一意な既存 event を基準にした相対条件が deterministic に正規化され、scheduler がその時間を避ける。
2. 曖昧な event 参照や未確定 offset は hard apply されず、confirm_reference または propose_assumption になる。
3. assumption は確定 fact と別に表示・追跡され、明示承認前に reducer state を上書きしない。
4. capacity shortage 時の dialogue action は deterministic diagnostics を fact reference として持つ。
5. 受理済みの予定、目標、期間を再質問しない。
6. validator reject を受理済みとして話さない。
7. preview candidate があるときは offer_preview に到達する。
8. provider failure と invalid action で deterministic fallback が成立する。
9. WP-DA-001 が action / state / rubric の全評価軸を持ち、自然文の完全一致に依存しない。
10. 実モデル eval の費用・遅延・fallback 指標を報告できる。

## 検証

relative constraint の unit / integration tests、weeklyPlanning suite、build、opt-in conversation eval を実行する。実モデルを呼ぶ場合は、通常 CI と分離し、入力データと call 数を記録する。git add、commit、push は行わない。
