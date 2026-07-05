# R2-C-eval: AI interpreter の実 AI 評価(手動スモーク + opt-in 自動評価1回)

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
