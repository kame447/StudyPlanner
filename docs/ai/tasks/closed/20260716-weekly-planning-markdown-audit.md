# 週間計画 Markdown 全件走査 completion record

Status: **closed / audit completed**
Completed: 2026-07-16
Target: `main`

## 走査範囲

週間計画MVP導入後に追加または変更された週間計画関連Markdown 74件と、repository入口の`README.md`を確認した。

確認観点は、task status、root配置、canonical文書間の競合、現行コードとの乖離、重複所有、closed文書内の未対応事項、superseded文書の帰属である。

## 整理済み

- PR #3に属するclosed済みroot task 6件を一つのcompletion recordへ統合した。
- conversation trace実装taskをcompletion recordへ移し、未完了のprivacy・運用論点を分離した。
- roadmapとdocs indexのcurrent queueをroot実態へ同期した。
- dialogue stack verificationを古いfeature branch前提から`main`基準へ変更した。
- dialogue stack implementation recordで、module実装とproduction entrypoint接続を区別した。
- task brief templateを現在のtask lifecycle規約へ同期した。

## 未決のため変更していない契約

次は単純な文書整理では決められない。

1. 通常provider経路で、deterministic baselineとAI結果をmergeするか、AIを唯一のsemantic interpreterとするか。
2. 「来週」を翌週月曜から日曜へ即時確定するか、scopeだけ保持して開始曜日を確認するか。
3. production traceをopt-inにするか、発話全文を保存するか、どのredactionとretentionを要求するか。
4. dialogue stack moduleをproduction entrypointへどこまで接続済みとみなすか。自動test、実entrypoint、browser verificationを分離して判定する必要がある。

上記はarchitecture、product spec、roleplay test plan、AI promptを一括で同期してから変更する。

## 残る統合候補

- legacy fallback semanticsとretirement条件
- runtime schema、command union、validatorの網羅性
- scheduler capacity policyとatomic split permission dialogue
- 時刻不定の生活制約
- rendererの不要AI callとdead state
- trace scalability、pagination、migration

これらはclosed文書から直接再開せず、実コードを再確認して独立taskを作成する。
