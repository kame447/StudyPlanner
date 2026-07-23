# 週間計画を汎用semantic V5へ移行する

Status: active / feature-flagged runtime trial connected
最終更新: 2026-07-23

## 1. 目的

院試専用typed command、exam state、exam schedulerへ意味解釈を閉じ込めず、一般学習、家事、仕事、生活予定を同じsemantic schemaとFact Graphで扱う。

AIは自然言語を厳密なStable V5 semantic documentへ変換する。Fact ID、state revision、質問選択、予定配置、preview、approval、保存はアプリcoreが決定する。

## 2. 実装済み

- `WeeklyPlanningSemanticDocumentV5`
- strict JSON Schema `weekly_planning_semantic_document_v5`
- Stable V5 system/user prompt
- direct validator
- initial call + 最大一回repair
- parser fallback禁止
- lifecycle付きdirect canonicalizer
- `WeeklyPlanningFactGraphV5`
- active / superseded / removed lifecycle
- task date、fixed commitment、availability resolver
- generic work item / generic scheduler input
- deterministic dialogue policy
- deterministic preview scheduler
- preview conversation / graph revision binding
- owner-bound persistence envelopeとcutover guard
- Stable V5 real-eval harness

## 3. 実環境trial接続

既存UIから次の経路を利用できるようにした。

```text
NaturalLanguageAssistant
→ weeklyPlanningTurnExecutor
→ Stable V5 runtime mode
→ AI structured output
→ Stable Fact Graph
→ deterministic scheduler
→ existing preview UI
→ existing approval / Plan save
```

有効化:

```text
アプリ設定 → 週間計画AI → Stable V5
```

開発・preview環境では次も利用できる。

```text
?weeklyPlanningRuntime=stable-v5
VITE_WEEKLY_PLANNING_RUNTIME_MODE=stable_v5
```

defaultはlegacyである。現行方式へ戻すと即時rollbackし、会話とGraphを初期化する。

## 4. 実環境安全境界

- existing planとtimetableのevent本文・ID・日時をAIへ渡さない。
- AIは予定日時を配置しない。
- provider/schema failureでparser fallbackしない。
- Graph revision不一致を拒否する。
- 古いpreviewを承認できない。
- 全作業を配置できない場合はpartial previewを返さない。
- non-study taskを`other`として保存する。
- runtime切替時に旧経路とStable Graphを混在させない。
- Graph V5未永続化中はStable会話・preview・draftをlocalStorageへ保存しない。

## 5. multi-turn

次の短答を決定論的に既存factへ結合する。

```text
3時間です
→ 単一のmissing effort targetへtotal durationを追加

今回進めたい量です
→ 単一のunresolved workloadをtargetへsupersede
```

expected revision一致、短い応答、単一target、単一candidateの場合だけ適用する。対象factの選択はAIへ任せない。

作成許可だけのturnでは既存factを再出力しない。

```text
この条件で予定を作って
→ planningIntent=create_plan
→ 新規factなし
```

## 6. preview scheduler

- default 09:00–22:00
- existing plans / timetable / fixed reservationsをoccupiedとして反映
- hard unavailable / availableを反映
- task allowed / excluded datesを反映
- splittable workを原則60分へ分割
- bufferを確保
- insufficient capacityでは全候補を破棄して再調整を要求

## 7. 検証コード

追加済み:

- runtime mode test
- Stable runtime executor integration test
- Stable creation-authorization prompt test
- contextual short-answer test
- task → 3時間です → 作成許可の三段階pipeline test
- deterministic preview scheduler test
- existing plan conflict test
- insufficient capacity atomic rejection test
- PlanType bridge test
- preview stale revision test
- production entrypoint boundary test

## 8. 未確認

GitHub Actionsがrunner step開始前にfailureとなり、logとartifactが生成されないため、Stable trial追加後の次は未確認である。

```text
semantic全test
tsc --noEmit
Vite production build
Worker routing test
Stable V5実AI real-eval
branch previewでの実browser roleplay
```

実行基盤failureをコード不合格またはAI評価失敗とは扱わない。ただし成功確認済みとも書かない。

## 9. 未完了

- Graph V5 repository persistence
- 現行stateからのdeterministic migration decoder
- production shadow telemetry保存
- calendar production adapter
- personalization scoring
- plan/actual learning pipeline
- proposal decision実適用
- 依存fact一括lifecycle transaction
- full renderer統合
- default cutover
- Alpha runtime依存削除

## 10. 次gate

```text
full automated verification
→ branch preview deploy
→ Stable V5を設定で有効化
→ 実AI structured output確認
→ browser roleplay
→ 発見不具合修正
→ migration / shadow / rollback検証
→ default cutover判断
→ 七視点監査
```

PR #77はDraftのまま維持し、mainへmergeしない。
