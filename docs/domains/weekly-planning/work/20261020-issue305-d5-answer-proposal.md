# Issue #305：D5 の固定分数メニューを、回答ごとの閉集合へ（既定 OFF）

Owner: WindyTesla（Orrery 親、Opus 5.5）。branch `feat/issue305-d5-answer-proposal`、base `origin/main` `8474777c4d6d616fd5ddeacadce808a02b3e8e3f`。
Issue #305 の #305b 最終報告（全 purpose NO-GO、2026-10-19）の後に、利用者が明示承認した新規の実装単位である。#305b の封印データ、採点、GO/NO-GO は変更しない。本番 Worker の公開、有料 API の再実行、フラグの変更はこの単位に含めない。

## 目的と範囲

D5（`missing_effort_estimate` への時間の回答）は、質問時に固定した分数 `[1,…,10,15,20,30,45,60]` から Jev に選ばせていた。「150分です」「2時間です」のような値はメニューに無く、Jev が正しく理解しても受理できなかった。

この単位は、メニューを「その回答に現れた数字から機械的に作る、解釈前の候補」に置き換える経路を、**既定 OFF の別 policy version** として追加する。意味の判断（どの候補か、該当なしか）は Jev が行い、値の格納先・単位・精度の検証、FactGraph への commit は既存の決定的コードが行う。

範囲外：C5、reply-reference、date の候補生成（date は plan window 由来のままで、a4-dt-01「水曜日です」の none は coverage の問題として別扱い）、Worker の catalog 変更、#736 の文法 parser、本番の校正値の設定。

## 3案の比較

| 案 | 候補の出どころ | 長所 | 主なリスク |
| --- | --- | --- | --- |
| A. 固定分数を拡大 | 質問時の定数（例：1〜240 分） | 生の文字列を読まない。既存の凍結契約のまま | 選択肢が 254 を超えると階層 menu になり Jev の呼出し回数と費用が増える。分布が平らになり、0.90 / 0.80 の gate を満たしにくい。それでも 26 や 1440 のような値は漏れる |
| B. 回答中の数字を「解釈前の候補」にする | 回答の ASCII / 全角の数字列 n から {n 分, 60n 分} | 選択肢が少なく（最大 8 + none）、Jev が1回で済む。数字が無い回答では Jev を呼ばない | 文字列を読むため、AGENTS.md の「raw text による意味確定の禁止」と衝突しうる。対策は下の「権限の境界」 |
| C. Graph と型付きモデル出力から作る | 既存 estimate や Luna の typed 出力 | 文字列を読まない | 回答の値は Graph に無い。Luna の typed 出力を使うと Luna を先に呼ぶことになり、Jev で置き換える意味が無い |

採用は **B**。A は費用と calibration の面で悪化し、C は答えの値に届かない。B の文字列処理は数字の文字種だけを見る（日本語の語彙、単位、助数詞、漢数字の辞書を持たない）ため、意味を確定する parser にはならない。ただし Graph との照合（C の要素）は、選択後の安全側の検証として取り入れる。

#305b の根本原因は候補集合ではなく、補助 head（condition_change / independent_meaning）が ≤ .01 の gate から大きく離れていたこと（D5 の最小値 .20 / .15）である。この単位の候補改善だけで GO になるとは主張しない。

## 権限の境界（変更しない約束）

- 数字の抽出は、候補を**増やす**ことだけに使う。意図、単位、対象、更新の有無をコードが決めない。抽出結果で候補を除外したり、Jev の結果を上書きしたりしない。
- 候補が1つも作れない回答（数字が無い、漢数字だけ、など）はこの経路を使わず、既存の Luna へ渡す。これは「候補が無い」という機械的な状態で、言語の意味の推測ではない。
- 数字と数字の間に `.` `,` `:` `/`（全角を含む）がある回答、または数字の前に小数点がある回答（「1.5時間」「1,500分」「1:30」「.5時間」）も候補を作らない。区切られた数字列は1つの値の断片で、整数の候補では正しい値を表せないため。文字種だけの規則で、語彙は使わない。
- `none` は常にメニューにある。Jev の none、低確率、補助 head の超過、失敗、stale は従来どおり Luna fallback。
- 選択後の Graph 照合：選ばれた分数、またはその元の整数が、active な FactGraph の他の数値（workload の amount / range の数字列、effort estimate の minutes、capacity の分数、recurrence の回数。対象自身の amount も含む）と一致したら、参照先が曖昧として受理しない（d5m-05「15です」の反例：兄弟の 15 分・15 ページと一致）。これは機械状態の比較で、言語の解釈ではない。
- 受理後は、既存の `createFocusedContextualAnswerDocumentV5` → 正規の validator / canonicalizer / FactGraph commit / receipt だけを使う。新しい mutation 経路を作らない。
- 補助 head の gate（.01）は本番でも既存 policy でも外さない。新しい calibration は下の事前登録案として分離する。

## 実装の形

- `weeklyPlanningRegisteredCandidateDomains.ts`：新しい policy version `d5-answer-proposal-2026-10-20-v1` と、その校正定数 `D5_ANSWER_PROPOSAL_CALIBRATION = null` を追加。校正が有効なときだけ登録し、既存の固定版より優先する（同じ question code を2つ登録すると registry は fail-closed になるので、どちらか一方だけ）。両方 null の今は何も登録されない。
- registry（`weeklyPlanningControlledCandidateRegistry.ts`）：domain が任意で持つ純関数 `proposeAnswerPayload(payload, userText)` を、凍結済みの質問時 payload と live 再取得の payload の両方に同じように適用する。これにより既存の「凍結 basis と live basis の一致」検査をそのまま保つ。この関数を持たない domain（現行の固定 D5、date）の挙動は不変。
- D5 domain：回答の数字列から候補分数を作り（重複除去、正の安全整数、上限 1440 分、最大 8 件、出現順）、凍結 record の `domainMinutes` をその集合に置き換える。候補ラベルと tuple の形は既存と同じ。Worker の wire 形式も不変。
- 選択後の Graph 照合を D5 の stage に追加（上記）。

## 校正の事前登録案（未実施・本番に配線しない）

利用者の高確信度案：leaves menu の top ≥ 0.90、1位と2位の差 ≥ 0.80。これは新しい policy version に対する**新規**の calibration であり、#305b の旧 holdout の gate を事後に変えたものではない。採否には、旧 holdout とは別の新しい dev / sealed holdout、補助 head の閾値の別途の事前登録、S1（誤受理 0）の確認が必要。旧 holdout は offline の候補 coverage 確認（Jev を呼ばない）にだけ使う。

## 事前登録で none を必須とする入力（S1）

新しい calibration の評価では、次の入力を「Jev が none を選ぶべき」集合に入れる。候補の中に正しい値が無い、または値が近似・範囲のため exact な葉で表せない例である。

- 「1時間半です」「1時間30分」（候補 1 / 60 / 30 分。正解 90 分は無い）
- 「1・5時間」（中黒は語彙側の記号なので文字種規則に入れない）
- 「25時間」（1500 分は上限で除外され、25 分だけが残る）
- 「2〜3時間」「6〜10分」（範囲）
- 「30分くらい」「10分前後」（近似。葉は常に exact）
- 「1問5分、英語も30分追加」「合計で70分です。あと締切を…」（複数節）
- 「15です」で兄弟に 15 がある場合（コードの Graph 照合で fallback するが、Jev 側の none も記録する）

top ≥ 0.90 を満たす正規化分布では2位は 0.10 以下なので、margin ≥ 0.80 は自動的に満たされる。margin は独立の条件として働かない点を事前登録に明記する。

## 旧 supp-holdout での offline 確認（記述のみ・Jev 不呼出し）

#305b の supp-holdout の D5 24件について、提案規則が作る候補に gold の分数が入るかだけを数えた。exact な eligible 5件のうち、固定メニューは 2件、提案は 4件を含む（含まないのは「1時間半」）。近似の gold は葉が exact なので対象外。これは候補の到達可能性で、Jev の正答率や GO/NO-GO ではない。旧 holdout の採点・封印・判定は変更していない。

## 監査の結果（PureBell、Opus）

GO-with-fixes、blocking なし。本番の不活性、registry の同値検査、質問時 record の不変、権限の境界は確認済み。指摘への対応：

- M1 小数・桁区切りの断片 → 候補を作らない規則を追加。
- M2 照合の漏れ → capacity の分数、recurrence の回数、range ラベル中の数字列（全角を含む）を追加。
- L1 / L2 → 上の S1 集合に追加。
- L3 → margin の独立 test は policy 上成立しないため削除し理由を記載。照合 test を拡充し、照合を外す変異で失敗することを確認。
- L4 → 質問時の placeholder が domain の固定メニューと一致する場合だけ提案を許す。

## 完了条件

1. OFF 時（両校正 null）、登録 domain は空で、既存の固定 D5 / date / C5 の挙動と wire が同一。
2. 提案経路を test 用 calibration で有効にしたとき：「1問5分です」「150分です」「2時間です」が mock Jev の選択で正規 commit される。「15です」（兄弟の値と一致）、none、低確率、補助 head 超過、数字なし（Jev 不呼出し）、複数節の mock none、stale は Luna fallback。
3. 抽出 helper が日本語の語彙・単位・漢数字の辞書を持たないことを architecture test で固定。
4. `npm run typecheck`、関連の focused test、`npm run verify` が成功。独立監査（Opus）で blocking finding なし。
5. 本番フラグ・Worker・校正値は変更なし。

## Checkpoint

- 2026-10-20：record 作成。実装は Orrery 子 KeenTuring（Sol 6.1）、独立監査は Orrery 子 PureBell（Opus）。監査指摘を親が反映。
