# 【最優先・根本】completion target を field 別に受理・保持する(「全部/できるところまで/2年分」)

実ブラウザスモークで、ユーザーが「どこまで進めたいか(target)」を答えても受理されず再質問ループになる。completion モデルが「完了済み(completedYears)」しか持たず、「これから進めたい範囲(target)」を field ごとに表現できないのが根本原因。

本mdの範囲外へ進まない。git add / commit / push はしない。production code は本タスク実装時のみ変更。

## 背景(実例)

実例3:
```text
アプリ: どこまで進めたいですか？
ユーザー: 出来るところまで終わらせたいです
アプリ: どこまで進めたいですか？
ユーザー: 全部かな
アプリ: どこまで進めたいですか？
```

実例4(field 別 target が無視される):
```text
ユーザー: ヒューマンサイエンスを全部終わらせたいのと、OSとソフトウェアは二年分はやりたい
（中略・後続で）
アプリ: どこまで進めたいですか？   ← 分野別 target を伝えたのに broad な再質問
```
最初の発話に「ヒューマンサイエンス=残り全部 / OS=2年分 / ソフトウェア=2年分」という **field 別 completion target** が含まれるのに、broad な completion 質問が繰り返される。

## 現行原因(コード確認済み)

- `StudyProgress`(`weeklyPlanningIntakeTypes.ts`)は `field / completedYears / completionBoundaryYear / incomplete / ambiguity` を持つが、**「これから進めたい target(全部 / N年分 / できるところまで)」を表す専用フィールドがない**。`completedYears` は「完了済み」であり target ではない。
- ambiguity `'completion_direction'` は「完了済み年度が新しい側からか古い側からか」の曖昧性であって、target(どこまでやりたいか)とは別概念。
- そのため「全部」「できるところまで」「2年分」「この分野は全部、別は2年分」を受理・保持する経路がなく、対応する missing が解消されず再質問が続く。target を保持できないので、AI interpreter がこれらを返しても validator / reducer が受け皿を持たない。
- field 別 target を保持できない(全体単位の completion しか扱えない)ため、実例4 の分野別指定が broad 判定で無視される。

## 対象範囲

- `StudyProgress`(または新 `CompletionTarget` 表現)に **field 別の completion target** を追加する。最低限の表現: `all`(残り全部)/ `latest_n_years`(N年分)/ `up_to_reachable`(できるところまで=試行的)/ 明示範囲。曖昧(できるところまで)は仮置き+最終確認に倒す。
- 決定的 parser(または AI interpreter の受け皿)で「全部」「できるところまで」「N年分」「この分野は全部、別はN年分」を command 化して受理する。command 型の追加が必要なら `mark_completion_target` 等を最小で足す。
- missing / status を「target 未確定」で正しく blocking し、target を受理したら解消する。field 別に部分受理された場合、残る field のみ尋ねる。
- remaining work items 生成が target を反映する(全部→全 year、N年分→最新 N、できるところまで→試行扱い)。

## 対象外

- 「完了済み年度(completedYears)」の既存受理・field scope 除外ロジックの変更(target とは別軸として共存させる)。
- 進捗単位の全面一般化(page/word 等・R3 本体)。本タスクは year 系 target に絞り、拡張可能な形にする。
- renderer の質問文表現(別タスク: renderer context)。
- 質問順序・数の制御(questionPlan 側)。

## 完了条件

- 「全部」「できるところまで」「2年分」が completion target として受理され、`どこまで進めたい` 系の再質問が止まる。
- 「ヒューマンサイエンスは全部、OS/ソフトは2年分」が **field 別 target** として保持され、broad な completion 再質問が起きない。
- 曖昧な target(できるところまで)は仮置き+最終確認に倒れ、無限ループしない。
- remaining work items が target を反映する。既存の completedYears 系テストが不変。
- weeklyPlanning テスト green / build 成功。

## 必要な regression test

- 「全部」→ 対象 field の全 year が target。再質問なし。
- 「2年分」→ 最新2年が target。
- 「できるところまで」→ 仮置き扱い・再質問ループしない。
- field 別: 「A は全部、B は2年分」→ A と B で別 target、未指定 field のみ残 missing。
- completedYears(完了済み)と target が共存するケース(実例4: HS 2025〜2022 完了 + 残り全部 target)。
- 既存の completion_direction / completedYears テストが期待値変更なし。

## roadmap 対応

R3(進捗単位一般化)の year 系先取り + R2 入力理解拡大。completion モデルの target 軸は R3 の `TaskProgressScope` 一般化の土台にもなる。roadmap の「次に切る候補」へ追加対象。
