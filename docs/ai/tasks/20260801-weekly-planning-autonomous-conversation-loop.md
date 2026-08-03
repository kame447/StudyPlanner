# 週間計画AI 自走会話改善ループ

Status: blocked by P0 semantic ownership reset
Date: 2026-08-03
Issue: #108
PR: #109
Branch: `agent/weekly-ai-conversation-eval`
Blocking task: [20260803-weekly-planning-ai-semantic-ownership-reset.md](20260803-weekly-planning-ai-semantic-ownership-reset.md)

## 目的

Stable V5の実API経路を複数ターン動かし、質問、誤回答、明示的修復、preview訂正、再preview、承認、保存まで自動確認する。
人間による毎回の入力とtrace受け渡しを減らす。

ただし、scenarioを通すこと自体を目的化しない。実API失敗を修正する際も、週間計画の最上位設計原則を守る。

## 最上位設計原則

> ユーザーの自然言語、会話文脈、指示・訂正・承認の意味理解はAIだけが担当する。決定論的な処理は、AIが出した意味表現に対する形式・参照・状態遷移・安全性の検証と適用だけを担当する。

この原則の詳細、禁止事項、失敗調査順、受け入れ条件はP0 blocking taskを正本とする。

## 固定方針

- application経路はStable V5のみ。
- AI APIは意味解釈と利用者向け返答生成だけに使う。
- ユーザー役、採点、合否判定、原因推定にはAIを使わない。
- assistant文面の部分一致で状態を推定しない。
- 特定発話向け例外、test削除、期待値緩和で通さない。
- 訂正対象はexact public IDで解決し、曖昧なら推測しない。
- preview訂正後の旧previewは承認不可。
- owner切替、再読込、保存失敗でデータを黙って失わない。
- AI出力とは別にユーザー文を読むproduction parserを追加しない。
- schema不足を正規表現やscenario固有patchで隠さない。
- 各ループで七視点監査を行い、自分の実装説明を信用しない。

## 七視点

1. runtime入口
2. 対話進行
3. 意味状態・Fact Graph
4. 訂正・preview lifecycle
5. テスト妥当性・過学習
6. trace・artifact・再現性
7. API費用・Secret・保存・運用安全性

## 1ループ

P0完了後は次の順序で再開する。

```text
七視点監査
→ AIへ渡したcontext確認
→ AI raw responseの意味確認
→ schema表現可能性確認
→ validator / formal binding / Graph apply確認
→ 最初の失敗境界を1つに絞る
→ task MD更新
→ 最小修正と回帰test
→ GitHub Actions
→ log / artifact再監査
→ 思想整合を確認
→ roadmap / task / PR本文更新
```

Actions実行中は次の変更を重ねない。

## scenario

1. 明日の自然な複数ターン計画と既存予定回避。
2. 来週・別表現・非学習task。
3. 誤単位回答からの明示的修復。
4. 英語と数学の複数target訂正。
5. preview後訂正、旧preview無効化、再preview。

scenario文面は再現用fixtureであり、production実装へ語句を転記しない。

## これまでに構築した基盤

- scenario registryと複数phase
- pure driver、contract、manifest、fake adapter test
- cross-turn correction applicationとrollback
- preview訂正後のmode再計算
- Stable V5 runtime固定
- attempt signatureによる無限会話停止
- manifestと必須発話・必須checkの同期
- bounded correction trace
- owner付きstagingとreload復元
- pending target消失時の原子的reject
- OpenAI手動eval
- AI-only経路、fail-fast、incremental artifact
- request circuit breaker
- canonical planning-window contract
- renderer date grounding
- source-of-truth Graphのowner-safe投影

これらの成功は、現在headで再検証されるまで自動継承しない。

## 2026-08-03 architecture regression

実APIの短答・作成承認・明示的訂正で失敗が続いた際、次の処理を追加した。

- short answerを正規表現で解釈し、AI出力を置換
- correctionを訂正語、作業名、数量で再解釈
- creation authorizationを語句列挙で判定
- user textから作業・数量を再抽出してAI出力を監査
- task boundaryを後段で意味的に分割
- relative date source textを読み直してAI出力を上書き

これは、以前固定した「AIが意味理解、deterministic coreが構造・安全性」という責務境界への回帰である。

特に「40問にかかる時間は3時間」の失敗では、AIは対象と所要時間をほぼ正しく表現していた。主要因は、effort estimateがworkloadを正式targetとして参照できないschema・validator制約だった。AIを迂回する後処理を追加した判断は誤りだった。

## 現在のblocker

P0 semantic ownership resetが完了するまで、実API改善ループを再開しない。

停止対象:

- 新しい自然言語正規表現
- 語句辞書
- scenario固有semantic patch
- AI responseの意味的置換
- AIを使わないshort answer / correction / authorization解釈

## 再開条件

- production semantic pathの責務監査が完了している。
- AI出力を意味的に置換する経路が除去されている。
- 所要時間とworkloadの参照問題がschema・validator・binding側で解決されている。
- architecture regression testsが追加されている。
- roadmapとP0 taskの受け入れ条件を満たしている。

## 再開後の順序

1. focused semantic tests
2. TypeScript checks
3. full Vitest
4. production build
5. architecture guard
6. OpenAI semantic schema eval
7. OpenAI conversation eval
8. artifactとtranscriptの七視点監査
9. task MDとroadmap更新
10. PR本文更新

## 未確認

- P0是正後のOpenAI実API会話5 scenario
- P0是正後のOpenAI semantic schema 4ケース
- transcriptの自然さ
- token usageと実費
- Production Worker、Firebase auth、ブラウザDOM、Playwright E2E
- merge前のcommit squash

PRはDraft・未mergeを維持する。
