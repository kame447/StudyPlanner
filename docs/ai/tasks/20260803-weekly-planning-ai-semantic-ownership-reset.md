# 週間計画 AI意味理解責務の再固定

Status: active / P0 architecture blocker
Date: 2026-08-03
Issue: #108
PR: #109
Branch: `agent/weekly-ai-conversation-eval`

## 目的

週間計画機能の根幹設計を、次の単一原則へ戻す。

> ユーザーの自然言語、会話文脈、指示・訂正・承認の意味理解はAIだけが担当する。決定論的な処理は、AIが出した意味表現に対する形式・参照・状態遷移・安全性の検証と適用だけを担当する。

今回の実API失敗対応で再導入された、AI出力とは別にユーザー文を読み直す正規表現・キーワード・簡易パーサーを除去する。失敗シナリオを通すための局所修正ではなく、意味理解と決定論的処理の責務境界を再設計する。

## 最上位原則

この原則は、個別のテスト成功、短期的な実装容易性、API費用、prompt短縮より優先する。

1. AIが唯一の意味理解担当である。
2. AIには現在発話、必要な会話履歴、機械可読な現在状態、直前質問の種別と対象を渡す。
3. 決定論的処理はユーザー文を再解釈しない。
4. AIの出力を受け取る前後で、別の日本語解釈結果へ置換しない。
5. AI出力が不正な場合は、理由を限定して最大1回だけAIへ修正させる。それでも不正ならfail closedとする。
6. AIが正しく表現した意味を現在のschemaが表現できない場合、AIを迂回せずschemaまたは適用層を直す。
7. 特定の発話、教科、数量、単位、scenarioを通すための語句列挙をproduction経路へ追加しない。

## 決定論的処理が担当してよいこと

- JSON schemaと型の検証
- 必須項目、列挙値、数値範囲、時刻形式の検証
- 参照先の存在、参照種別、所有者、revisionの検証
- machine pending questionと回答対象の整合確認
- AIが選択した対象を既存の正式IDへ結び付ける処理
- 完全に同一で意味を変えない重複の除去
- すでに選択済みの意味を変えない表記正規化
- Fact Graphの追加・更新・削除・supersede・rollback
- readiness、scheduler、preview、承認、保存、再読込の安全制御
- stale preview、二重承認、二重保存、owner混線の拒否

## 決定論的処理が担当してはいけないこと

- 「今回進めたい」「残り」「終わった」などの語句から数量の役割を推定すること
- 「違います」「ではなく」などの語句から訂正内容を再構築すること
- 「この条件で作って」などの表現から作成承認を判定すること
- ユーザー文から作業名・数量・単位を再抽出し、AI出力の欠落を独自判定すること
- 作業名や子項目名を比較し、独立作業か共通作業かを意味的に決定すること
- 日付表現をユーザー文から読み直し、AIの解釈を上書きすること
- AI出力を検証する前に、ルール側で作った別文書へ差し替えること
- provider failureまたはvalidation failure時にparserへfallbackすること

## 今回確認した回帰

PR #109では、実API失敗への対処として次が追加された。

- 短答を正規表現で解釈してAI出力を置換する処理
- 明示的訂正文をキーワード・作業名・数量で再解釈する処理
- 作成承認を語句列挙で判定する処理
- ユーザー文から作業と数量を再抽出する欠落検査
- AIが生成した作業構造を後段で意味的に分割する処理
- ユーザー文の相対日付を読み直してAI出力を修正する処理

特に「40問にかかる時間は3時間」の失敗では、AIは対象と所要時間をほぼ正しく表現していた。失敗原因は、所要時間が数量情報を対象にできないschema・validator側の制約だった。ここでAIを迂回する実装を追加したことが回帰である。

## 失敗調査の必須順序

今後、実APIまたは会話テストが失敗した場合は、必ず次の順で確認する。

1. AIへ必要な会話履歴と現在状態が渡っているか。
2. AIのraw responseが意味的に正しいか。
3. schemaがその意味を表現できるか。
4. validatorが正しい出力を誤拒否していないか。
5. 正式IDへの結び付けで壊れていないか。
6. Fact Graphへの適用で壊れていないか。
7. dialogue、preview、承認、保存で壊れていないか。

1〜7を確認する前に、ユーザー文を読む新しい正規表現、語句辞書、parserを追加してはいけない。

## 実施フェーズ

### Phase 0: semantic patch freeze

- 新しい自然言語正規表現、語句辞書、scenario固有分岐の追加を停止する。
- PR #109の実APIループは、この是正が終わるまで新しい意味補正を追加しない。
- 現在の回帰実装を一覧化し、削除・移動・維持を分類する。

### Phase 1: production経路の責務監査

少なくとも次を監査する。

- contextual short-answerの独自解釈
- creation authorizationの独自解釈
- direct work coverageのユーザー文再抽出
- task boundaryの意味的自動分割
- planning windowのsource text再解釈
- duplicate workload正規化
- repair prompt生成
- canonicalizerとvalidatorの参照制約

各処理を次の3分類へ分ける。

- 意味理解なのでAIへ戻す
- 意味を変えない機械的検証・変換なので残す
- schema不足を隠す処理なのでschema修正後に削除する

### Phase 2: schemaと適用層の修正

- 所要時間が、作業全体だけでなく対象の数量情報へ正しく関連付けられるようにする。
- 短答で既存の作業構造を毎回再生成しなくてよい表現方法を決める。
- 直前質問への回答、既存情報の訂正、操作の承認をAIが明示的に表現できる契約を設計する。
- AIが選んだ既存対象とmachine pending questionが食い違う場合は、後段で意味を選び直さず拒否する。
- schema変更前に、既存Fact Graph、訂正適用、preview lifecycleへの影響を文書化する。

### Phase 3: 回帰実装の除去

- AI出力を検証前に置換する経路を削除する。
- 短答、訂正、承認を判定するproduction用正規表現を削除する。
- ユーザー文から作業・数量を再抽出する本番検査を削除する。
- 意味判断を伴う自動分割・上書きを削除する。
- 機械的重複除去など、意味を変えない処理だけを残す。

### Phase 4: architecture regression tests

次をテストで固定する。

- validなAI responseは、後段で別の意味文書へ置換されない。
- raw responseとaccepted documentの意味要素が一致する。
- AI responseが不正な場合、後段でユーザー文を解釈して成功扱いにしない。
- provider failure時にparser fallbackしない。
- schemaが表現できない正しいAI出力を、scenario固有patchで通さない。
- task、数量、単位、言い換えを変えても同じ責務境界が保たれる。
- productionコードへ新しい自然言語語句列挙が追加された場合に検知できる。

### Phase 5: verification

1. TypeScript checks
2. semantic/unit tests
3. full Vitest
4. production build
5. diff/architecture guard
6. OpenAI semantic schema eval
7. OpenAI conversation eval
8. transcriptとraw responseの七視点監査

実API失敗時は、本書の失敗調査順序へ戻る。

## 受け入れ条件

- AI出力を意味的に置換するproduction経路がない。
- 短答、訂正、承認の日本語解釈を行う独立parserがない。
- 今回の所要時間問題がschema・参照設計の修正で解決されている。
- validatorは意味を選び直さず、構造・参照・安全性だけを判定する。
- architecture regression testが追加されている。
- 実API artifactで、AI raw responseからaccepted semantic documentへの意味的な置換がないことを確認できる。
- roadmap、本task、PR本文が現在の実装と一致している。

## タスクMD運用

今後の週間計画実装は、コード変更より先に必ず`docs/ai/tasks/`へ独立したtask MDを作成または既存taskを更新する。

各task MDには最低限、次を記載する。

- 目的と非目的
- 本ロードマップ上の位置
- 守る設計原則
- 変更対象と変更禁止範囲
- 失敗原因の抽象化
- 他に起こり得る事例
- 実装順序
- テスト戦略
- 受け入れ条件
- 実測結果と未確認事項

実装中は各ループの結果をtask MDへ追記する。完了時はroadmapとtask statusを同じ変更で更新し、未完了内容を口頭説明だけに残さない。
