# Weekly Planning resumable real-API turn hardening

## 背景

Actionsをまたいで同一の週間計画会話を1ターンずつ進める実API評価基盤で、2ターン目がVitest既定の5秒タイムアウトに到達した。

初回ターンも約4.7秒であり、特定の発話だけが遅いのではなく、実ネットワーク・OpenAI API・semantic normalizer・dialogue rendererを通る実APIターン全般に対して5秒という単体テスト既定値が不適切である。

今回の目的は特定シナリオを通すことではなく、今後の探索的P2P会話テストをActions越しに安定して継続できる基盤にすることである。

## 7視点監査

### 1. 利用目的・対話品質

このテストの目的は固定ケースの高速回帰ではなく、実APIを通した会話を1ターンずつ観察する探索的結合テストである。5秒以内に返ること自体は製品仕様ではないため、Vitest既定5秒を合否条件にしてはいけない。

### 2. 会話継続・状態同一性

前runのcheckpoint取得、conversationId、PlanningState、Stable V5 graphの復元は2ターン目でも成功している。今回の失敗は状態復元前後の不整合ではなく、復元後の実APIターン実行中に発生している。したがって状態モデルを変更してはいけない。

### 3. API・外部依存

実APIはネットワーク遅延とモデル応答時間を含む。初回約4.7秒、2回目は5秒を超えたため、5秒固定はフレークを生む。実API評価専用の明示的タイムアウトを設け、通常の単体テスト既定値とは分離する必要がある。

### 4. テスト設計・回帰耐性

特定発話だけにtimeoutを付ける、または今回の2ターン目だけ例外扱いする修正は禁止する。同じresumable real-API turn入口を使う全ターンへ一律に適用し、環境変数で上書き可能な専用timeoutとする。

### 5. 診断・artifact

現在はテスト本体がVitest timeoutで中断されるとwriteOutputsまで到達せず、transcript/latest-turn/checkpointが生成されない。その結果、artifact uploadも追加失敗し、元の原因が見えにくくなる。実APIターンのtimeoutはテスト関数の外側で突然打ち切られる既定5秒に依存させず、十分な評価用timeoutの内側でアプリ側の失敗診断を残せる構造を維持する。

今回は基盤の規模を広げすぎないため、artifact形式そのものの再設計は行わない。評価用timeoutを超えた場合はActionsログを一次診断とする。通常のAPI失敗については既存のlatest-turn/trace出力を維持する。

### 6. CI安全性・コスト

無制限待機にはしない。workflow全体には30分上限が既にあるが、1ターン単位にも独立した上限を設定する。既定は60秒とし、環境変数で変更可能にする。これによりAPIハング時にActionsが長時間滞留することを防ぐ。

このworkflowは命令ファイル更新時のみ起動し、1runで1ユーザー発話だけを送る既存方針を維持する。APIリクエスト回数上限も変更しない。

### 7. 既存契約・変更範囲

Stable V5 semantic/canonicalization/scheduler/dialogueの実装には触れない。会話内容を通すためのプロンプト変更、状態補正、期待値緩和も行わない。変更対象は実API評価ハーネスの時間境界だけとする。

## 修正方針

`weeklyPlanningResumableConversation.real-eval.test.ts` に実APIターン専用timeoutを追加する。

既定値は60,000msとする。`WEEKLY_PLANNING_RESUMABLE_TEST_TIMEOUT_MS` が正の有限数として指定された場合のみ上書きする。不正値では既定値を使う。

Vitestの `it(..., timeout)` にこの値を渡し、通常の単体テスト既定5秒から分離する。

workflow側にも `WEEKLY_PLANNING_RESUMABLE_TEST_TIMEOUT_MS=60000` を明示し、Actions上の契約を可視化する。

## 非目標

会話内容の修正は行わない。
Stable V5の意味解釈を変更しない。
スケジューラやrendererを変更しない。
今回の高校生シナリオだけを通す分岐を追加しない。
API応答時間そのものを性能要件として評価しない。

## 検証条件

型検査が通ること。
checkpointの既存決定論テストが通ること。
1ターン目のcheckpointから同一conversationIdで2ターン目を再開できること。
2ターン目で5秒を超えてもVitest既定timeoutでは失敗しないこと。
新しいcheckpointとtranscriptが生成されること。
会話内容・graphの事実は修正前と同じアプリ経路だけで生成されること。
