# 週間計画対話の文脈・永続化・送信UIを堅牢化する

Status: open
Created: 2026-07-16

## 目的

週間計画の既存機能を壊さず、対話文脈、質問生成、会話履歴、送信中UI、責務分割を一般化して改善する。

今回の優先順位は次のとおりである。

1. 現行機能の回帰を防ぐ
2. traceで再現した状態不整合を直す
3. カレンダーや既知状態に基づく質問へ一般化する
4. 会話履歴を明示的なクリアまで保持する
5. 送信中UIの二重表示を解消する
6. 肥大化したUI責務を段階的に分離する

## 調査で確認した問題

### 固定予定の質問が文脈を利用していない

登録済み予定がpipelineへ渡っているにもかかわらず、質問文は一律に「授業・バイト・通院など、動かせない予定があれば教えてください」となっている。既知の予定を先に示して差分を尋ねる責務がない。

また「通院」は特定ユーザーの利用文脈に寄った例であり、一般的な初期質問の代表例として固定する必要がない。

### 単一分野でも優先順位を要求する

`applyPriorityMissingState`はexam scopeが存在し、unit rateがあれば分野数を見ずに`priority_policy`と`next_field_after_math`を追加する。そのため分野が1件しかない場合にも「優先したい分野」を尋ねる。

traceではdeterministic parserが年度範囲だけを持つ部分scopeを作り、AIが補完した`fields: ["OSnetwork"]`を`confirmed-slot-overwrite`で拒否した。このため単一分野情報が消え、優先質問の不自然さがさらに悪化した。

### 会話状態が画面を閉じると失われる

`NaturalLanguageAssistant`が会話履歴とintake stateをcomponent-local stateとして保持している。既存の`PlanningState.messages`とlocalStorage実装はUIから利用されておらず、draftが0件ならstorage自体を削除するため、対話のみの状態を保持できない。

### 送信中に入力欄と発話履歴が二重表示される

ユーザー発話は送信開始時に履歴へ追加される一方、textareaは応答完了後までクリアされない。このため同じ文が入力欄と会話履歴に同時表示される。

また成功応答を会話履歴とstatus cardの双方に入れるため、応答側にも二重表示の可能性がある。

### 責務が集中している

`NaturalLanguageAssistant.tsx`は自然言語単発入力、週間計画対話、pipeline実行、会話履歴、preview、承認UIを同一componentで扱っている。`QuickEntryModal.tsx`も入力種別切替と各入力フォームの調停を抱えている。

今回のリファクタリングでは全面書換えを避け、まず週間計画の会話sessionと表示部品を分離し、既存pipelineとpreview責務を維持する。

## 実装順

1. exam scopeの部分補完と単一分野priorityの回帰修正
2. 登録済み予定を根拠にした固定予定質問
3. 会話sessionの永続化
4. 送信中typing indicatorと入力欄の切替
5. 週間計画会話表示のcomponent分離
6. 全体回帰確認とCodexレビュー用md作成

## 非目標

- schedulerの配置アルゴリズム全面改修
- 外部Google Calendar連携の新規実装
- AIに未確認予定を推測させること
- 全UIのデザイン刷新
- `NaturalLanguageAssistant`全体の一括書換え

## 完了条件

- [ ] 登録済み予定がある場合、既知予定を示して追加予定を尋ねる
- [ ] 登録済み予定がない場合、個人事情に寄らない一般的な質問をする
- [ ] exam scopeの部分情報をAI補完で安全にmergeできる
- [ ] 分野が1件なら優先分野を尋ねない
- [ ] modalを閉じて再度開いても会話履歴とintake stateが復元される
- [ ] 「履歴をクリア」操作だけが会話sessionを消す
- [ ] 送信中にtextareaへ送信済み文を残さない
- [ ] 送信中はassistantのtyping indicatorを表示する
- [ ] 成功応答を履歴とstatus cardへ重複表示しない
- [ ] 関連テスト、build、diff checkが通る
- [ ] 本mdをclosedにし、Codex確認用mdを作成する
