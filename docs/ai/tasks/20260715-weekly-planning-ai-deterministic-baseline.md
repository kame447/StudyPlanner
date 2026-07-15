# AI interpreter経路のdeterministic baseline

Status: closed
Closed: 2026-07-15
Parent: `20260715-weekly-planning-dialogue-path-issue-breakdown.md`

## 対象問題

AI interpreterを利用する経路では、ユーザー発話をstateへ追加した後、AIが返したcommandだけを適用していた。そのためrules parserが解釈できる「来週」などの情報が、AIのcommandに含まれない場合に失われていた。

一方、従来のrules経路をそのままAI前処理へ入れるとlegacy task extractionまで動作し、短答を新しいタスクとして誤認するため、そのまま併用することはできなかった。

## 実施内容

legacy fallbackを含まないdeterministic command phaseを分離し、AI interpreter呼び出し前のbaselineとして適用した。

AIが正常応答した場合はdeterministic stateへAI commandを補完的に適用する。providerが例外になった場合だけ、legacy fallbackを含む従来のrules経路へ切り替える。

## 完了条件

- [x] 「来週の予定立てたい」に対してAIが`begin_weekly_planning`だけを返してもpending planning rangeが保持される
- [x] AI成功時にlegacy task extractionを混ぜない
- [x] AI空応答時もdeterministic parserの結果を保持する
- [x] provider例外時だけ従来のfull rules fallbackを使用する
- [x] 既存のinterpreter foundationテストと追加回帰テストが通る

## 対象外

取得後のdialogue action優先順位、fallback renderer、聞き返し文脈は別taskで扱う。
