# 週間計画 旧思想移植・ヒューリスティック監査・実API検証

Status: active
Date: 2026-08-12
PR: #120
Branch: `agent/weekly-planning-human-grounding-repair`

## 目的

過去の週間計画pipeline・実装・historical roadmapを棚卸しし、現在のStable V5責務境界を壊さずに有効な概念を移植する。

完了報告は推測で行わない。deterministic regression、full CI、実OpenAI APIの逐次会話、実OpenAI APIの通し会話を実行し、最後にproductionで実際に使われるヒューリスティックを全列挙する。

## 非交渉の責務境界

- raw user textと会話文脈の意味理解はAIが担当する。
- deterministic codeはschema/reference/evidence validation、formal binding、Fact Graph lifecycle、revision/idempotency、readiness、質問優先度、scheduler、preview、approval、saveを担当する。
- 旧日本語regex/parserをsemantic source of truthとして復活させない。
- 科目名だけから固定時刻・認知負荷・優先度を決めない。
- hard constraintをpersonalizationやheuristic scoreより先に適用する。
- 実績データをAIへそのまま渡さず、必要なdeterministic集約値だけをschedulerへ渡す。

## 棚卸し分類

過去資料の項目は必ず次に分類する。

1. 旧productionで実装済みだった能力
2. 現Stable V5に既に同等以上の能力がある
3. historical roadmap / designだけで、旧productionには未実装
4. 現Stable V5へ移植する価値がある
5. raw text依存・過学習・責務逆転のため不採用

「古いMDに書いてある」だけでは旧実装済みと扱わない。

## 現在までに移植・強化した概念

- human-scale effort質問とformal answer binding
- page/problemのper-unit effort
- vocabularyのtotal/session effort切替
- vocabulary 100語上限のdeterministic session分割
- vocabulary sessionをpreview work itemまで保持
- execution profile / session policy
- session chunking
- distinct taskの開始日分散
- daily load ranking / overload回避
- tiny-tail回避
- 重い作業の長いfree segment優先
- preferred date / preferred window
- existing plan / timetable buffer
- scheduler break
- task relation ordering
- before / after / dependency / sequenceの実時刻順制約
- relation cycleのblocking
- request-time not-before
- reserve / review既存policyの保持
- Actual由来のowner-scoped estimate calibration
- intrinsic durationを校正対象外にする境界
- canonical weekday availability compatibility

## 意図的に復活させない旧方式

- 日本語keyword/regexをsemantic truthとして使うparser
- `英語なら13時`、`数学なら14:30`のような科目名→固定時刻rule
- 根拠のない生活profile永続化
- product policyが未定義な固定spaced-repetition間隔
- historical roadmapだけに存在した機能を「旧実装」とみなすこと

## 実API監査

### 逐次会話

GitHub Actionsのresumable observationを使い、1 turnごとにcheckpointを復元する。

各turnで確認する。

- AI raw semantic document
- validation / repair
- canonical graph diff / revision
- scheduler issues
- selected pending question target
- renderer response
- authorization persistence
- preview candidate count
- failure diagnostics

返答はrenderer文面の文字列ではなくmachine pending targetを見て決める。

2026-08-12の第1回観測では、AIは`weekday:tuesday`を正しく出したがavailability resolverが旧`tue`形式だけを期待し`invalid_weekday`を出す実バグを検出した。canonical weekday compatibilityを修正し、full CI green後に新規conversationでTurn 1から再実行した。

修正後Turn 1では`invalid_weekday`は消え、数学40問の`missing_effort_estimate`が正しく選択された。

### 通し会話

逐次会話完了後、同じproduction boundaryを使って一つの実API job内で開始からpreviewまで通す。

固定renderer文面をoracleにしない。machine stateから必要な回答を選び、preview到達・constraint保持・authorization保持・failureなしを検証する。

## final gate

完了条件:

1. legacy思想棚卸しが分類済み
2. 採用概念がproduction経路へ接続済み
3. 移植ごとの対象回帰green
4. TypeScript green
5. full Vitest green
6. production build green
7. diff check green
8. 逐次real API conversationがpreviewまで完走
9. 通しreal API conversationがpreviewまで完走
10. 7視点敵対的監査でBLOCKER/MAJORなし
11. current contract / roadmap / semantic roadmap / current statusが現コードと一致
12. productionのdeterministic heuristic inventoryをコード根拠付きで全列挙

このgateを満たすまで「完全に完了」とは報告しない。
