# #926 VNext 本番リリース作業記録（2026-11-01〜）

Owner: PurplePasteur（親 Opus 5.5、standalone）。Issue [#926](https://github.com/kame447/StudyPlanner/issues/926)、PR [#928](https://github.com/kame447/StudyPlanner/pull/928)、branch `feat/issue926-vnext-conversation-core`。

## ユーザー承認範囲（2026-11-01）

- VNext を本番の週間計画会話コアとして提供してよい。V5 はソース・Git 履歴に残し、比較・再利用可能に保つ。本番ビルド／ルーティング／デプロイ導線に V5 を残す必要はない。恒久的な V5 fallback は作らない。
- 既存 E2E 全件と、実 API を含む VNext E2E を同一 HEAD で green にしてから、既存 CI・PR・merge・Cloudflare（Pages 自動／Worker 手動）・Firebase の正規経路で反映する。
- 失敗時の巻き戻しは既存の安全な方式（Pages の前 deployment、Worker の前 version）。DNS・認証・有料サービス設定は変更しない。

## 現在地

- 再起動前の親 SturdyGauss の未コミット統合（任意の「ほかに作業は？」質問・辞退・closed の V5 再利用）と Luna の OI03 評価修正を `a5946cc9` に統合し、push 済み。focused 511 pass、typecheck exit 0。元の worktree（SturdyGauss / JauntyRamanujan / DarkFeynman）は変更していない。
- （開始時点）本番接続は未実施で、VNext はローカル開発ホスト＋ビルドフラグ＋クエリのときだけ選ばれていた。現在の選択は下の「本番化で確定した設計」のとおり。

## 本番化で確定した設計

- 会話コアの選択は一か所（`useWeeklyPlanningConversationApplication`）。既定は VNext。Stable V5 は `VITE_WEEKLY_PLANNING_CORE=stable_v5` かつローカル開発ホストのときだけ（比較・V5 固有回帰用）。本番ホストでは V5 を選べない。通常ビルドでは V5 hook をコンパイル時に除外する。
- V5 の持つ正しい純粋責務（scheduler、preview、renderer、approval、trace collector）は既存 boundary 経由で再利用する。
- 既存 E2E のうち V5 固有の意味解析モックに依存する spec は、製品挙動を検査するものは VNext の provider 契約へ移植し、V5 の意味解析だけを検査するものは V5 比較 project で走らせる。期待値の緩和・skip は禁止。

## 分担

| 担当 | 内容 |
|---|---|
| 親 | 設計・統合・commit/push・CI・E2E 実行・merge・deploy・本番確認 |
| Sol（prod-switch） | 本番の会話コア選択の切替、V5 の本番バンドル除外、既存 V5 ローカル会話の移行確認、isolation/LocalRuntime テスト |
| Sol（e2e-port） | E2E 全 spec の分類と、会話コアに依存する spec の VNext 移植／V5 比較 project 化 |
| Sol（worker-readiness） | Worker（AI proxy・Jev・trace server write）の VNext 本番要求との互換、durable turn 非使用時の中断・復帰、Worker deploy 要否 |
| Astra | `a5946cc9` 以降の独立監査（OI03 閉鎖、意図分類・事実・固定予定・分割可能な所要時間・確認文・訂正状態の仕様照合、テストの妥当性） |
| Gemini | 実 API artifact の日本語応答評価 |

## 完了条件

1. 本番切替を含む最終 HEAD で typecheck・test:run・build・CI 全 required check が成功。
2. 既存 E2E 全 project/shard（Browser Regression、UI Matrix、UI Quality、stability、Lighthouse、emulator）と VNext 実 API E2E が同一 HEAD で成功。skip は合格に数えない。
3. Astra の blocking finding（L×S≥15 または安全・データ）が 0。
4. PR merge → Pages 自動 deploy → Worker deploy（必要時）→ 本番 URL で画面と代表対話フローを確認し、deploy SHA / Worker version を記録。
5. Issue/PR を根拠付きで整理。

## Checkpoint log

- 2026-11-01 11:00 JST: `a5946cc9` push。次は子 3 体と Astra を起動。
- 2026-11-02: ユーザー指示で体制変更。子は全員 Claude Sonnet 5.5（Sol/Luna/Gemini/Opus 子は使わない）、Astra は全ゲート後の最終監査のみ。旧子（Sol 4 体）の未コミット差分を回収・統合（`d7957e2e`）。
- 2026-11-02 01:30 JST（最大速度の追加承認後）: 親 HEAD `04360f2c`（ローカル）。Sonnet 子 4 体、load average 約 27 のため増員は保留。

| 子（Sonnet 5.5） | 担当 | 状態 |
|---|---|---|
| DeftPauling | VNext の durable turn（Worker job 実行・再読込後の再開・取消・複数チャット） | 実装中（`cacc13c0`＋再開修正） |
| EagerArrhenius | E2E 移植と全 Playwright の順次実行（ブラウザ実行はこの 1 体のみ） | emulator 9/9（`04360f2c` 統合済み）、main config 実行中 |
| GustyPasteur | 選択・複数チャット・保存失敗・V5 除外 bundle（統合済み）→ 本番確認計画、後で VNext runtime の遅延読み込み | 本番確認計画を作成中 |
| BrassLovelace | 開始対象・出力上限・Worker リリース計画（統合済み）→ full suite 負荷時の Jev テスト失敗の原因特定 | 調査中 |

残り：durable の統合、VNext runtime の遅延読み込み（bundle 予算）、全 E2E、Jev テスト失敗の原因、origin/main（`7643adc5`）の取り込み、push 後の CI、有料 VNext 実 API ×3、最終 Astra、merge、Worker→Pages の順で deploy、本番確認。

- 2026-11-02 05:20 JST（最終監査前）: 候補 `fb067ac9` で、CI・Browser・UI Matrix 全 7 job・Agentic・UI Quality・Admin・Lighthouse・有料実 API（vnext×3：36/37・37/37・37/37、vnext-worker：成功）が green。ゲートごとの根拠表、挙動の変更台帳、rollback の実対象（`7643adc5` / `be237c6d`）での確認、Jev の本番ゲート、日本語レビューは、Issue #926 の checkpoint 32–34 と PR #928 本文に記録した。最終 HEAD はこの記録と durable reload テストの堅牢化（遅い再開を正しく busy と扱う）を含む。全ゲートを最終 HEAD で再実行してから、Astra の read-only 監査を行う。
- 残る非 blocking（backlog）：renderer の表現（訂正で旧値が出ない、「毎週」と言わない、初回の短い応答。L×S 14 以下。V5 と共有の renderer なので有料の確認が必要）、否定された登録を model が固定タスクとして読む揺れ（L3×S2=6）。
- 文書とコードの不一致：`current-contract-v5.md` は空き時間だけの入力に任意の招待が要らないと書くが、V5 の実装と契約テストは招待を出す。コードに従った（AGENTS.md の規則）。
