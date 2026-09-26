# 週間計画 focused authorization の日本語意味評価

Status: active / 評価基盤は実装済み、Gemini agent は pilot 1 run のみ（反復は quota 待ち）、human-reviewed gold は未作成
Updated: 2026-09-26
Tracking: Issue #333（#305 の canary 前提条件の日本語品質 gate を所有する）

この記録は、Jev と既存 Luna の日本語解釈を同じデータで評価する手順と、gold を確定する条件を保持する。最初の評価単位は「既存の条件から未保存の計画案を作ってよいか」の二択（`create_plan` / `fallback`）である。これは Jev の恒久的な範囲ではない。Luna が担う意味解釈・判断を責務ごとに比較し、条件を満たした単位から段階的に Jev へ移す（採否と順序は #305）。実行順序は [`../roadmap/current.md`](../roadmap/current.md)、Jev の rollout 条件は #305 が owner であり、ここでは重複させない。

## 不変条件

- 本番は `JEV_MODE=off` / `JEV_CANARY_PERCENT=0` のまま。この記録の作業はどれも shadow / canary を開始しない。
- Gemini は Orrery 上で起動する評価専用の Antigravity agent であり、REST API adapter や `GEMINI_API_KEY` は使わない。production の semantic model でもない。
- Gemini の判定は `gemini_judged_candidate` で、gold ではない。
- 既存51件と追加80件は `synthetic_unreviewed` のまま。synthetic label を持つ51件との不一致は候補抽出であり、「正解率」ではない。
- Jev と Luna の一致率（`jevLunaAgreement`）は正解率ではない。
- 通常 CI（`npm run test:run`）は有料 API、agent 起動、secret を要求しない。packet export と judgment import 自体にもネットワークは不要である。
- Jev 置換単位ごとの安全性回帰は #335（#152 から移管）、dialogue quality は #156 が owner であり、この評価で代替しない。

## データの状態

| 状態 | 意味 | 作る主体 |
| --- | --- | --- |
| `synthetic_unreviewed` | PR #332 の51件と、#333 の追加80件。追加候補は label を持たない | 作成者（モデル）|
| `gemini_judged_candidate` | blind packet に対する Gemini agent の一次判定。人手レビューの優先順位付けにだけ使う | Orrery Gemini agent |
| `needs_adjudication` | 2人の blind 判定が一致しない | 人手 |
| `human_reviewed_gold` | 異なる2人の blind 一次判定が一致した、または記録付きの adjudication を経たもの | 人手 |

split は会話 group 単位で固定する。同じ状況から派生した言い換えは同じ group に置き、group は split をまたがない（validator が拒否する）。既存51件の inventory では、「はい」が tuning と holdout で異なる文脈とともに重複している（`crossesSplits: true`）。これは意図的な文脈対比だが、human review で扱いを確認する。

## 評価 runner

| 目的 | コマンド | 必要なもの |
| --- | --- | --- |
| Jev 単体（split 別） | `JEV_EVAL_SPLIT=tuning npm run eval:jev:shadow` | `OPENROUTER_API_KEY` |
| Jev / Luna の同一 case 比較 | `JEV_EVAL_SPLIT=tuning npm run eval:jev-luna` | `OPENROUTER_API_KEY`, `OPENAI_API_KEY` |
| Gemini agent 用 packet export（通信なし） | `GEMINI_AGENT_JUDGE_RUNS=3 npm run eval:gemini-agent:packets` | なし |
| Gemini agent 判定 import（通信なし） | `GEMINI_AGENT_JUDGE_RUNS=3 npm run eval:gemini-agent:import` | 各 run の `judgments.json` と `agent.json` |
| 人手レビュー用シート（通信なし） | `npm run eval:review-sheets` | なし |

`eval:gemini-agent:packets` と `eval:gemini-agent:import` は専用 Vitest config を使う opt-in script で、通常 CI には含めない。run 数は1〜3、既定3である。

- `JEV_EVAL_SPLIT` は `tuning` / `holdout`（Jev 単体のみ `all` も可）を明示指定する。未指定は通信前に失敗する。
- Gemini agent artifacts は gitignore 済みの `artifacts/issue333-gemini-agent/` に置き、commit しない。mapping と import 出力は synthetic label を含むので、reviewer にも agent にも渡さない。
- Luna の費用は、明示した価格表を渡したときだけ計算する（推測しない）。live runner は価格表を渡さないため、Luna と focused boundary の `costUsd` は未知として件数を数え、token 数だけを記録する。fallback 込みの費用比較には、確認済みの価格表を渡す必要がある。
- 比較 report は focused boundary（Jev accepted なら Jev、abstain / unavailable なら Luna）までを測る。fallback 後に続く generic semantic の latency / cost は含まず、その件数を `continuesToGenericSemantic` で示す。production validator が拒否する context は Jev を呼ばず、Luna のみの経路として別集計する。
- 指標は件数と分母を先に見る：class 別 confusion count、false-positive `create_plan`、Clopper–Pearson 片側95%上限、Wilson 区間、Luna 単独と focused boundary の paired discordance（b/c と exact McNemar）。同じ会話 group の言い換えは独立標本ではない。

## Orrery Gemini agent の blind 実行手順

1. 親作業ツリーで packet runner を実行する。run ごとの `run-<k>/packet.json` と、agent に渡さない `mappings/run-<k>.json` が生成される。packet は `packetId`、prompt/rubric/schema、opaque `itemId`、直前の assistant 発話、現在の user 発話だけを含む。case id、会話 group、layer、split、source、synthetic label、Jev/Luna 出力は含まない。
2. 各 run について、repository の外の新しい directory を指定して `scripts/issue333-gemini-agent-blind-base.sh <new-repo-dir> artifacts/issue333-gemini-agent/run-<k>/packet.json [task-readme.md]` を実行する。helper は StudyPlanner と object も ref も共有しない独立した git repository を作り、`packet.json` と任意の `README.md` だけの commit を1つ置いて、その SHA を出力する。`--check <new-repo-dir>` で、commit が1つだけであることと tree の中身を確認する。
3. Orrery から `spawn_gemini_child.sh --worktree-base <sha> ... "<task>" <new-repo-dir>` で Antigravity CLI（program `agy`、既定 launch model `gemini-3.8-flash-high`）の Gemini agent を起動する。WORKDIR に blind repository を指定するので、agent の worktree からは StudyPlanner の履歴・label・mapping に到達できない。agent は packet の `responseFormat` に厳密に従った `judgments.json` だけを書く。run 同士は同時に起動せず、1本ずつ実行する（同時起動では、起動時の認証確認での通信失敗が続いた）。
4. 親は `judgments.json` を対応する `run-<k>/` へ回収し、同じ場所へ `{ "name", "launchModel", "effort" }` の `agent.json` を書く。agent が実際の model を報告できる場合は `judgments.json` の `agentReportedModel` に記録する。
5. import runner を実行する。packetId 不一致、JSON 不正、未知/重複 itemId は run 全体のエラーとする。既知 item の schema 不正は `invalid_response`、欠落は `missing` とし、値を補正しない。各 record は agent 名、program `antigravity`、launch/reported model、effort、packet SHA-256、prompt/schema version、run index を保持する。latency/token は agent transport から得られないため記録しない。
6. import は `gemini-records.json`、`gemini-aggregates.json`、`summary.json`、`adjudication.json` / `.csv` を生成する。summary は judged/invalid/missing、class 分布、不安定 case、synthetic label を持つ51件だけの不一致を分ける。どの出力も gold と呼ばない。

agent worktree の source に StudyPlanner 自身を使うと、`git log --all` などで label や mapping の seed を読めるため禁止する。mapping は常に run directory の外に保ち、blind commit へ入れない。packet の SHA-256 は整形済み JSON bytes に対して計算され、import record まで保持される。

## Human review の手順

1. `npm run eval:review-sheets` で、51件と追加80件の計131件について、`artifacts/issue333-human-review/for-reviewers/` に A / B の blind sheet を、`parent-only/` に opaque id の mapping、adjudication sheet、gold 出力を生成する。reviewer に渡すのは `for-reviewers/` だけである。
2. 日本語話者2名が別々に A / B を埋める。blind sheet には opaque id、直前の assistant 発話、ユーザー発話、rubric（`focused-authorization-rubric-v1`）だけが載る。Gemini の判定、synthetic label、layer、split、case id は見せない。
3. 両方の一次判定を lock してから、`HUMAN_REVIEW_A_CSV` と `HUMAN_REVIEW_B_CSV` を指定して `npm run eval:review-sheets` を再実行し、一致した case の gold と、不一致 case の adjudication sheet を得る。Gemini 判定を並べた adjudication sheet は、同じ2つの CSV を `GEMINI_AGENT_JUDGE_BLIND_REVIEW_A_CSV` / `_B_CSV` に指定して `npm run eval:gemini-agent:import` で得る。Gemini の判定はこの段階で初めて参照してよい。
4. 裁定を `HUMAN_REVIEW_ADJUDICATION_CSV` に指定して `npm run eval:review-sheets` を再実行すると、`parent-only/` に gold と比較用 label map が出る。裁定には reviewer、日付、メモが必須で、両方の一次判定を保持する。裁定者は一次 reviewer のどちらでも第三者でもよく、誰が裁定したかを記録する。`ambiguous` と `exclude` は二値比較の label map から除外し、件数と case id を別に報告する。

rubric v1 は実装側の草案である。gold 作成前に product owner が文言（特に「ありがとう」単独、既存条件の再確認、古い文脈の扱い）を確認する。

## holdout の扱い

- threshold、Jev の質問構成、judge prompt、rubric、corpus の調整は tuning の結果だけで行う。
- holdout の結果を見たあとの変更は、その holdout を消費したものとして扱う。以後の acceptance には、新しい sealed group を用意する。
- pipeline、rubric、gold 規則を固定してから holdout を開く。agent、model、prompt、schema version を記録する。

## Luna 責務の棚卸し（比較対象の候補）

Jev への段階置換に向けて、Luna（`gpt-5.6-luna`）が現在担う意味解釈・判断を一覧にする。棚卸しは `cc0a53c7` 時点のコードを読み取ったものである。Jev への適合度と順序は評価前の提案であり、採否と順序は #305 が、置換単位ごとの安全性回帰は #335 が決める。「全面的に置換できる」ことは、どの行についても実証していない。

| # | 責務 | 出力 | Jev 適合（提案） | 比較に必要な証拠 / 安全上の懸念 |
| --- | --- | --- | --- | --- |
| 1 | focused authorization（未保存の計画案を作ってよいか） | 二択 | 実装済みの候補（off / shadow / canary） | 本記録の評価。create でない発話を create にする誤りが最重要 |
| 2 | focused contextual answer（pending question への返答の解釈） | 列挙値4種 + 分の数値 | 分解可能：decision / effortTarget / quantityRole は選択式。`minutes` は Luna に残す | pending target ごとの typed tuple gold。provisional_timebox は scheduler 許可になるため厳格に |
| 3 | generic semantic normalization（文書全体の抽出） | 構造化された自由値 | 置換困難（開集合の抽出） | 将来、振り分けだけの前段分類なら検討の余地 |
| 4 | generic repair | 文書全体 | 置換困難 | — |
| 5 | dense turn の網羅性 audit | complete / incomplete + 不足ヒント | 分解可能：判定は真偽の問いにできる。低確信度は incomplete（Luna の再試行）に倒す | complete の誤判定で事実が落ちる |
| 6 | no-op completeness retry | 文書全体 | 置換困難 | — |
| 7 | pending task への時間的な制約の付随 | 列挙値 + 日付・時刻 | 分解可能：制約の有無・種類は選択式。日付・時刻は Luna | plan 全体の不可を task に誤って付ける |
| 8 | temporal scope repair（plan 全体の不可か、不確実か） | 二択 | 候補：abstain が安全側（`uncertain`）と一致する | 発生頻度が低く、合成ケースが中心になる |
| 9 | user context の日付 repair | ISO 日付 | Jev の対象外（決定的な日付計算の owner かどうかは別途判断） | — |
| 10 | planning window repair | ISO 範囲 | 置換困難 | — |
| 11 | dialogue renderer | 文章 | 対象外（判断は既に決定的なコードが持つ） | — |
| 12 | 「AIが覚えていること」の解釈（`user_context_interpreter`） | 列挙値（domain / kind）+ 自由値 | 分解可能：domain / kind は選択式。自由値は Luna | 一時的な条件を永続記憶として保存する誤り |
| 13 | 添付画像の読み取り | 文字起こし | 対象外 | — |

順序の提案は、#1 の証拠を完成させたうえで、#8 → #2 の閉じた分岐（quantity role / provisional timebox）→ #12 → #5 / #7 である。「分解可能」な行では、選択を Jev、値を Luna が持つ形になり、意味の owner が分かれる。これは `weekly-planning-semantic-ownership-boundary-v5.md` の「一つの意味には一つの owner」に照らした確認が必要である。

## canary 判断へ返すもの（#305）

- human-reviewed gold の件数（class 別、split 別、group 数）
- holdout での false-positive `create_plan` の件数と Clopper–Pearson 上限。ゼロ誤りでも、上限を 5% / 1% 未満にするには、それぞれ 59 / 299 件の独立した negative が必要である。
- selective accuracy と coverage（accepted create / accepted fallback を分けて）、abstain / unavailable 率
- Luna fallback を含む focused boundary の結果と、Luna 単独との paired 比較
- Gemini agent と human gold の不一致一覧
- 許容リスク（false-create 上限）は gold 収集前に owner が決める。

## 現在の checkpoint

- branch: `feat/issue-333-japanese-semantic-eval`（base main `c98d18e0`）
- 実装済み：tuning / holdout の別実行、51件の inventory、追加80件（label なし）、Luna fallback 例外時の turn 相関、Jev / Luna 比較 harness（pre-provider parity、paired 統計）、Orrery Gemini agent 用の blind packet export と strict import、double blind review sheet、Luna 責務の棚卸し

### Gemini agent 一次判定（pilot）

- 実施：2026-09-26。schema v1、1 run、Orrery の Antigravity agent（launch model `gemini-3.8-flash-high`、自己申告 `Gemini 3.8 Flash`）。対象は blind packet の131件。agent の worktree の tree には packet と README しかないが、pilot の blind base は StudyPlanner の object store 内の commit だった。そのため、label の非参照は指示による blind にとどまる（以後は独立 repository に変更した）。
- 結果：judged 130 / invalid 1 / missing 0。51件は create_plan 18 / fallback 31 / ambiguous 1、追加80件は create_plan 32 / fallback 44 / ambiguous 4。reviewRequired は51件で4、追加80件で22。
- synthetic label との不一致は2件（`stored-injection-07` を create_plan、`abnormal-value-04` を ambiguous）。どちらも human review での裁定対象である。これは gold ではなく、正解率でもない。
- invalid 1件は contract の不整合による：v1 の公開 schema は空文字列を許していたが、validator は拒否した。schema v2 で公開 schema を validator に合わせた（version を上げたので v1 と v2 は混ぜない）。pilot の結果は v1 の記録として保持し、安定性の評価には使わない。pilot は `f64ac726` 時点の import で取り込んだ。現在の import は、mapping に記録された prompt / schema version が一致しない場合（version を持たない v1 mapping を含む）を拒否するため、v1 の判定が v2 と表示されることはない。
- 反復（v2、3 run）は未完了：3回の起動が失敗した。原因は、起動時の認証確認での通信失敗が2回、実行途中の `UNAUTHENTICATED (401)` が2回で、その後の起動は Antigravity の個人 quota 上限（約7日後にリセット）で停止した。v2 packet と blind base は生成済みなので、quota が戻ったら run 1〜3 を1本ずつ実行し、`npm run eval:gemini-agent:import` で取り込む。

### 未完了（人手・外部が必要）

- human-reviewed gold v1（2名の blind review と裁定）、rubric v1 の owner 確認、許容リスク（false-create 上限）の決定
- Gemini agent v2 の3 run（quota 待ち）
- Jev / Luna の実 API 比較（OpenRouter の key が local / GitHub secret にない）
- #305 への申し送り：canary で Jev 評価中に deadline / client abort が起きた場合の失敗は、Luna fallback 前なので turn 相関の marker が付かない（本 branch 以前からの挙動で、今回の Luna fallback 例外の範囲外）
