# Weekly Planning resumable real-API failure observability

## 背景

Actions越しの1ターン実API会話テストで、通常の高校生発話

「夏休みの課題もまだ終わってなくて、2週間後に共通テスト模試もあるので、その勉強も進めたいです。特に数学が結構まずいです。」

を送ったところ、Stable V5 normalizer が `normalization_rejected` となった。

現在の評価ハーネスは `result.failure` を検出すると即座にthrowするため、その前にdebug traceとartifactを書き出せない。結果として、validation errorの詳細やAIのraw responseを失い、会話不具合の原因を調査できない。

## 7視点監査

### 1. 探索的対話テストの目的

この基盤の目的は「テストをgreenにすること」ではなく、実際の発話でどこが壊れたかを人間とAIがログから診断することである。したがって失敗ターンこそ最も多くの診断情報を残す必要がある。

### 2. 会話状態の安全性

失敗したユーザーターンを成功扱いでcheckpointへ追加してはいけない。再開可能な正本は直前の成功checkpointのまま維持する。失敗runから再開しても、内部状態が失敗ターンを受理済みと誤認しないことが必要である。

### 3. 原因追跡可能性

`failure.code` と集約済みの `schema_validation` だけでは原因特定に足りない。既存debug traceにはprovider raw response、validation errors、repair attemptが記録されるため、失敗時にも `takeWeeklyPlanningStableV5DebugTrace(requestId)` を実行して保存する。

### 4. テスト契約

アプリ側のfailureをテスト成功に変えてはいけない。artifactを保存した後でテスト自体は引き続きfailureにする。これによりCI上の赤表示と診断可能性を両立する。

### 5. artifact設計

失敗runでも最低限 `checkpoint.json`、`latest-turn.json`、`transcript.md`、`resume.json` を生成する。

`checkpoint.json` は直前の成功状態をそのまま保持する。
`latest-turn.json` には今回試行したuserText、failure、result message、requestId、debug traceを保存する。
`transcript.md` には成功済みターンの後へ「Failed attempt」として今回入力とシステム結果を追記し、成功ターン番号には含めない。
`resume.json` のnextTurnIndexは成功済みターン数+1のままとする。

### 6. CI・再実行性

失敗時にもartifact uploadが成功するため、二重エラーで本来の原因が埋もれない。修正後は直前成功checkpointを使って同じ発話を再試行できる。API呼び出し回数や会話ロジックは変更しない。

### 7. 変更範囲・汎化性

特定の `normalization_rejected` だけを特別扱いしない。provider failure、normalization rejected、canonicalization rejectedなど、`WeeklyPlanningTurnExecutionResult.failure` を返すすべての実APIターンに同じ診断保存経路を適用する。

Stable V5 normalizer、schema、prompt、canonicalizer、scheduler、dialogue rendererはこの段階では変更しない。まず観測可能性を回復してから、得られた具体的なvalidation errorsを別途7視点監査する。

## 修正方針

実API評価ハーネスに失敗出力専用処理を追加する。

`submitWeeklyPlanningApplicationTurn` 後にrequestId/resultを取得したら、failure判定より前にdebug traceを取得する。

failureの場合は直前checkpointを変更せず保存し、失敗試行の情報を `latest-turn.json` と `transcript.md` に出力してからthrowする。

成功の場合は従来通りruntime graphとPlanningStateを新checkpointへ保存する。

## 非目標

今回の高校生発話を通すためのprompt修正は行わない。
validationを緩めない。
AI出力を決定論的コードで補正しない。
失敗ターンを会話履歴へ成功ターンとして追加しない。

## 検証条件

失敗ターンでもartifactが生成されること。
失敗runのcheckpointが直前成功checkpointと同じ成功ターン数を保つこと。
latest-turnにraw traceとvalidation errorsが残ること。
CIはアプリfailure時に赤のままであること。
修正後に同じ成功checkpointから同じユーザー発話を再実行できること。
