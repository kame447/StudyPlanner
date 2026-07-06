# R2-C-eval: AI interpreter の実 AI 評価(手動スモーク + opt-in 自動評価1回)

> **実施記録(2026-07-05・Phase 1 完了)**
>
> - **結果: 実 AI 到達成功、抽出品質良好、受信側不整合で全滅。**
> - 実ブラウザから ai-proxy への POST と AI 応答を確認(既存 Cloudflare proxy 構成のまま・鍵移動なし)。評価ケース第1号に対し、AI は `set_exam_scope`(fields 5件・yearRange 2025〜2019・strategyHint・unitModel)と `set_priority_policy`(field_first・order)を返した。期間指定ターンでも `set_planning_range` を返した。抽出品質は有望。
> - しかし AI 応答の command に `confidence` が含まれず(response schema が要求していないため)、candidate parser の all-or-nothing 検査で**全候補が破棄**され、state に反映されなかった。アプリ応答は「条件の整合性が取れず…」となった。調査詳細と原因は `docs/ai/tasks/20260705-weekly-planning-ai-candidate-contract-fix.md` の背景を参照。
> - 受信契約の不整合修正は上記 fix タスクへ分離。**R2-D は fix タスク完了後に進む**(本タスクの Phase 1 完了により「実 AI 評価1回」は達成済みだが、受信契約が直るまで renderer 接続に進まない)。
> - Phase 2(opt-in 自動評価)は未実施・未判断のまま(評価用 key の用意はユーザー判断)。fix タスク完了後に実施すれば、修正後の契約での自動評価を兼ねられる。

> **追記(2026-07-05・継続対話スモークの結果)**
>
> - schema 完全化後の再スモークで、AI は完全な payload(set_exam_scope / set_priority_policy)を返したが、`needsConfirmation` が candidate 単位ではなく top-level に位置ずれし、parser で全候補が破棄された(strict: false 下の契約ドリフト)。また決定的 parser 側でも「1年分は3時間」の totalYears=1 誤解釈(phantom scope)と yearRange 単独入力の喪失、「固定予定はありません」(丁寧形)の不受理が確認された。
> - 対応タスク: `20260705-weekly-planning-candidate-wrapper-simplification.md`(最優先)、`20260705-weekly-planning-scope-parser-misparse-fix.md`、`20260705-weekly-planning-no-fixed-events-polite-form.md`。
> - **R2-D 着手条件の更新**: 上記のうち candidate ラッパー簡素化と scope parser 修正が完了し、**継続対話スモークで exam scope と unit rate が両立すること**を確認してから R2-D へ進む。
> - **発見事項(未タスク化)**: `update_life_constraint` の apply が1件で `sleep_cycle` / `meal_bath_constraints` / `life_constraints` の3つの missing を一括除去する粗い粒度になっている(sleep 1件で食事・風呂の不足まで解決済み扱いになる)。実害は未観測だが、missing 管理の kind 単位化を将来タスク候補として記録する。
> - **発見事項(2026-07-05 追記・yearRange 単独受理の再設計条件)**: scope parser 修正の実装検証で、yearRange 単独入力から examPrepScope を決定的に新規生成すると、(a) 部分進展が escalation の「進展あり」判定を満たして AI 呼び出しを抑止し、決定的 parser では抽出できない fields / priority order が失われる、(b) 部分 scope の確定で `confirmedSlots` に `exam_scope` / `year_range` が入り、AI の完全な `set_exam_scope` が `confirmed-slot-overwrite` で拒否されうる、という実害が確認された(foundation テスト3件の失敗として顕在化)。このため yearRange 単独生成は取り下げ、AI escalation に委ねる現行方針を維持する。**将来 yearRange 単独の決定的受理を実装する場合は、escalation の部分進展判定(未消化の情報が残るターンでは部分進展でも escalate する等)と、validator の scope enrich 粒度(確定済み partial scope への fields 充実を許可する仕組み)をセットで再設計すること。**単独の parser 変更で入れてはいけない。

R2-C(`docs/ai/tasks/closed/20260704-weekly-planning-r2c-ai-connection-goal.md`、条件付きクローズ)から分離した、**実 AI 評価だけ**を扱う小タスク。コード変更・テスト変更は行わない(評価の実行と記録のみ)。

**R2-D(renderer 実接続)の着手条件: 本タスクの実 AI 評価が少なくとも1回完了していること。**

## 背景

R2-C で実 interpreter・縮退・評価ハーネス・opt-in UI 接続まで完成したが、実 AI 評価は未実施のまま。前回の評価実行(candidates: [] / 3ms)は接続前エラーの縮退であり、実評価に到達していなかった。原因は (a) 評価用 API key / model が環境にない、(b) Node の評価ハーネスからは Cloudflare proxy 経路が Firebase ログインセッション必須のため構造的に通らない、の2点。評価ハーネスはエラー可視化済みで、今後は「未到達」と「実評価0件」を区別できる。

評価対象は評価ケース第1号(`weeklyPlanningEvaluationCases.ts` の `aiInterpreterFoundation`): 「数学とOSとハードウェアとソフトウェアとヒューマンサイエンスがあって、2025〜2019までそれぞれある。分野ごとにまとめてやる。数学から始めて最後がヒューマンサイエンスかな」。

## Phase 1: ブラウザ経由の手動スモーク評価(既存 proxy 構成のまま・必須)

**Cloudflare proxy 構成・Worker・secret・コードを一切変更しない。** 鍵の移動もゼロ。

1. 実アプリを起動し、Firebase ログイン済みの状態で、AI provider 設定(AI assist / Cloudflare Workers 経由)が有効であることを確認する(`getAiConfigValidationMessage` が UI 上エラーを出していないこと)。
2. 週間計画モードで、範囲確定ターン(例: 「今日の19時から土日の終わりまで予定立てたい」)の後に、評価ケース第1号の文を入力する。
3. **DevTools の Network タブ**で、ai-proxy への POST(`.../chat/completions`)が発生することと、そのレスポンス(`content` の JSON)を確認・保存する。これが「実 AI に到達した」ことの証拠になる(コード変更なしで観測できる)。
4. アプリ挙動でも受理を確認する: fields / 年度範囲 / 優先順が受理されれば、以後の質問が変わる(同じ「分野や年度の優先順」を繰り返さない)はず。medium confidence の部分順序が assumption として扱われているかも応答から確認する。
5. 記録する項目: 実行日時 / 使用モデル / proxy リクエストの発生有無 / レスポンス content(candidates 相当)/ アプリ応答の変化 / 体感レイテンシ / 気づき(誤解釈・rejected 相当の挙動)。

AI が期待どおりの candidates を返さなくても**このタスクの失敗ではない**(プロンプト改善の材料として記録する。改善の反復は別タスク)。

## Phase 2: opt-in 自動評価1回(評価用 API key を安全に用意できる場合のみ)

評価用 OpenAI API key を用意できない場合、この Phase は**実施せずスキップした旨を記録して完了**とする(Phase 1 が完了していれば R2-D 着手条件は満たす)。

実施する場合の手順:

1. 鍵は**実行シェルの環境変数としてのみ**渡す。`.env` を含むいかなるファイルにも書かない。安価なモデルを指定する。
2. `VITE_CLOUDFLARE_AI_PROXY_URL=`(空)で上書きして proxy を迂回し、直接 OpenAI 経路で評価する(Node からは proxy 経路が通らないため。Cloudflare 構成には触れない)。

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  WEEKLY_PLANNING_REAL_AI_EVAL=1 \
  VITE_CLOUDFLARE_AI_PROXY_URL= \
  VITE_AI_API_KEY=<評価用キー> \
  VITE_AI_MODEL=<安価なモデル> \
  npm run test:run -- src/features/weeklyPlanning/__tests__/weeklyPlanningAiInterpreter.real-eval.test.ts
```

3. 実行は**1回のみ**。出力される評価 JSON(passed / latencyMs / candidates / accepted / rejected と理由 / error)を記録する。error が記録された場合は「未到達」なので、原因を記録して報告する(リトライで押し切らない)。
4. 実行後、シェル履歴に鍵が残らないようにする。

## 完了条件

- Phase 1 の手動スモークが実施され、記録項目が報告されている(実 AI 到達の証拠を含む)。
- Phase 2 は「実施して評価 JSON を記録」または「key を用意しない判断でスキップ」のどちらかが明記されている。
- 本タスク完了をもって R2-D の着手条件が満たされたことを報告に明記する。

## 触らない範囲 / 停止条件

- production code・テスト・評価ハーネスの変更(必要になったら停止して報告。評価ハーネスの不備が見つかった場合は修正せず発見事項へ)。
- Cloudflare Worker / wrangler 設定 / secret の変更。鍵をファイルへ書くこと。
- プロンプトのチューニング反復(記録のみ。改善は次タスク)。
- 評価の複数回実行によるコスト増(各 Phase 1回まで)。
