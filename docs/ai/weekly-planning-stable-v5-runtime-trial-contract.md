# Weekly Planning Stable V5 Runtime Trial Contract

Status: canonical for runtime connection state
最終更新: 2026-07-23

この文書はStable V5の実環境接続状態だけを定める。semantic model、availability、migrationの詳細契約は既存current contractとarchitectureを継承する。接続状態に関して既存文書と競合する場合、この文書を優先する。

## 1. 現在の接続状態

Stable V5は既存週間計画UIへfeature flag付きで接続済みである。

```text
NaturalLanguageAssistant
→ weeklyPlanningTurnExecutor
→ Stable V5 structured output
→ direct validation / Fact Graph V5
→ deterministic dialogue / scheduler
→ existing preview UI
→ existing approval / Plan save
```

defaultはlegacyであり、全ユーザーcutoverではない。

## 2. 有効化

```text
アプリ設定 → 週間計画AI → Stable V5
```

開発・preview用:

```text
?weeklyPlanningRuntime=stable-v5
VITE_WEEKLY_PLANNING_RUNTIME_MODE=stable_v5
```

「現行方式」へ戻すと即時rollbackする。切替時は会話、preview、Fact Graphを初期化する。

## 3. AI責務

AIは自然言語をStable V5 semantic documentへ構造化する。

AIは次を決めない。

- target factの最終選択
- missing優先順位
- 質問
- readiness
- placement
- preview
- approval
- save
- external event

provider/schema failureでparser fallbackしない。

## 4. runtime safety

- existing planとtimetableはAIへ送らず、アプリschedulerへ直接渡す。
- Graph revision不一致を拒否する。
- 古いpreviewを承認できない。
- insufficient capacity時にpartial previewを返さない。
- non-study taskを`other`として保存する。
- Stable Graphはowner/conversationへ拘束する。
- runtime generationを同一conversationで混在させない。

## 5. multi-turn

次の短答を単一の未解決factへ決定論的に結合する。

```text
3時間です
今回進めたい量です
```

expected revision、短答形、単一target、単一candidateを満たす場合だけ適用する。

「この条件で予定を作って」のような許可turnでは、AIは既存factを再出力しない。

## 6. persistence boundary

Fact Graph V5は現段階ではsession-memoryのみである。Graph persistenceがない状態で会話だけ復元しないよう、Stable V5モード中の会話、preview、draftはlocalStorageへ保存しない。ページ再読込後は新規sessionから開始する。

## 7. 未確認

次は成功未確認である。

```text
full semantic tests
tsc --noEmit
Vite production build
Worker routing
Stable V5実AI real-eval
実browser roleplay
```

GitHub Actionsはrunner step開始前にfailureとなり、logとartifactがない。これは実行基盤failureであり、コード不合格またはAI評価失敗とは判定しない。

## 8. merge gate

PR #77はDraftのまま維持する。branch previewで実AIとbrowser roleplayを行い、発見不具合を修正するまでmainへmergeしない。
