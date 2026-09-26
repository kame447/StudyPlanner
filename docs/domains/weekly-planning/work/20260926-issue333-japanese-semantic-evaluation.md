# 週間計画 focused authorization の日本語意味評価

Status: active / 評価基盤は実装済み、human-reviewed gold は未作成
Updated: 2026-09-26
Tracking: Issue #333（#305 の canary 前提条件の日本語品質 gate を所有する）

この記録は、Jev と既存 Luna の日本語解釈を同じデータで評価する手順と、gold を確定する条件を保持する。最初の評価単位は「既存の条件から未保存の計画案を作ってよいか」の二択（`create_plan` / `fallback`）である。これは Jev の恒久的な範囲ではない。Luna が担う意味解釈・判断を責務ごとに比較し、条件を満たした単位から段階的に Jev へ移す（採否と順序は #305）。実行順序は [`../roadmap/current.md`](../roadmap/current.md)、Jev の rollout 条件は #305 が owner であり、ここでは重複させない。

## 不変条件

- 本番は `JEV_MODE=off` / `JEV_CANARY_PERCENT=0` のまま。この記録の作業はどれも shadow / canary を開始しない。
- Gemini は評価専用の一次 judge であり、production の semantic model ではない。Gemini の判定は `gemini_judged_candidate` で、gold ではない。
- 既存51件と追加候補は `synthetic_unreviewed` のまま。現在の「正解率」系の数値は、すべて暫定 label に対する一致度である（report は `provisional: true`）。
- Jev と Luna の一致率（`jevLunaAgreement`）は正解率ではない。
- 通常 CI（`npm run test:run`）は有料 API や secret を要求しない。実 API runner はすべて opt-in。
- Jev 置換単位ごとの安全性回帰は #335（#152 から移管）、dialogue quality は #156 が owner であり、この評価で代替しない。

## データの状態

| 状態 | 意味 | 作る主体 |
| --- | --- | --- |
| `synthetic_unreviewed` | PR #332 の51件と、#333 の追加候補。追加候補は label を持たない | 作成者（モデル）|
| `gemini_judged_candidate` | Gemini の一次判定。人手レビューの優先順位付けにだけ使う | Gemini |
| `needs_adjudication` | 2人の blind 判定が一致しない | 人手 |
| `human_reviewed_gold` | 異なる2人の blind 一次判定が一致した、または記録付きの adjudication を経たもの | 人手 |

split は会話 group 単位で固定する。同じ状況から派生した言い換えは同じ group に置き、group は split をまたがない（validator が拒否する）。既存51件の inventory では、「はい」が tuning と holdout で異なる文脈とともに重複している（`crossesSplits: true`）。これは意図的な文脈対比だが、human review で扱いを確認する。

## 評価の実行

| 目的 | コマンド | 必要なもの |
| --- | --- | --- |
| Jev 単体（split 別） | `JEV_EVAL_SPLIT=tuning npm run eval:jev:shadow` | `OPENROUTER_API_KEY` |
| Jev / Luna の同一 case 比較 | `JEV_EVAL_SPLIT=tuning npm run eval:jev-luna` | `OPENROUTER_API_KEY`, `OPENAI_API_KEY` |
| Gemini 一次 judge | `GEMINI_JUDGE_MODEL=<model> npm run eval:gemini-judge` | `GEMINI_API_KEY` |
| 人手レビュー用シート（通信なし） | `npm run eval:review-sheets` | なし |

- `JEV_EVAL_SPLIT` は `tuning` / `holdout`（Jev 単体のみ `all` も可）を明示指定する。未指定は通信前に失敗する。
- 出力は gitignore 済みの `artifacts/issue333-gemini-judge/` に置き、commit しない。
- 比較 report は focused boundary（Jev accepted ならJev、abstain / unavailable なら Luna）までを測る。fallback 後に続く generic semantic の latency / cost は含まず、その件数を `continuesToGenericSemantic` で示す。production validator が拒否する context は Jev を呼ばず、Luna のみの経路として別集計する。
- 指標は件数と分母を先に見る：class 別 confusion count、false-positive `create_plan`、Clopper–Pearson 片側95%上限、Wilson 区間、Luna 単独と focused boundary の paired discordance（b/c と exact McNemar）。同じ会話 group の言い換えは独立標本ではない。

## Human review の手順

1. `npm run eval:review-sheets` で A / B 2枚の blind sheet、opaque id の mapping、adjudication sheet を生成する。
2. 日本語話者2名が別々に A / B を埋める。blind sheet には opaque id、直前の assistant 発話、ユーザー発話、rubric（`focused-authorization-rubric-v1`）だけが載る。Gemini の判定、synthetic label、layer、split、case id は見せない。
3. 両方の一次判定を lock してから adjudication sheet で不一致を裁定する。Gemini の判定はこの段階で初めて参照してよい。裁定には reviewer、日付、メモが必須で、両方の一次判定を保持する。
4. `ambiguous` と `exclude` は二値比較の label map から除外し、件数と case id を別に報告する。

rubric v1 は実装側の草案である。gold 作成前に product owner が文言（特に「ありがとう」単独、既存条件の再確認、古い文脈の扱い）を確認する。

## holdout の扱い

- threshold、Jev の質問構成、judge prompt、rubric、corpus の調整は tuning の結果だけで行う。
- holdout の結果を見たあとの変更は、その holdout を消費したものとして扱う。以後の acceptance には、新しい sealed group を用意する。
- pipeline、rubric、gold 規則を固定してから holdout を開く。model / prompt / schema version を記録する。

## canary 判断へ返すもの（#305）

- human-reviewed gold の件数（class 別、split 別、group 数）
- holdout での false-positive `create_plan` の件数と Clopper–Pearson 上限。ゼロ誤りでも、上限を 5% / 1% 未満にするには、それぞれ 59 / 299 件の独立した negative が必要である。
- selective accuracy と coverage（accepted create / accepted fallback を分けて）、abstain / unavailable 率
- Luna fallback を含む focused boundary の結果と、Luna 単独との paired 比較
- Gemini と human gold の不一致一覧
- 許容リスク（false-create 上限）は gold 収集前に owner が決める。

## 現在の checkpoint

- branch: `feat/issue-333-japanese-semantic-eval`（base main `ef5102b2`）
- 実装済み：tuning / holdout の別実行、51件の inventory、Luna fallback 例外時の turn 相関、Jev / Luna 比較 harness、Gemini judge contract、double blind review sheet
- 未実行：実 API 比較。local にも GitHub secret にも OpenRouter / Gemini の key がないため。
- 未完了（人手が必要）：human-reviewed gold v1、rubric の owner 確認、許容リスクの決定
