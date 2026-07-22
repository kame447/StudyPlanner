# V5日付スキーマの実AI評価

Status: harness implemented / execution blocked before model call
Date: 2026-07-22
Branch: `test/weekly-planning-semantic-schema-eval`
PR: #77

## 目的

V5 alpha2 semantic normalizerが、非連続日と曜日集合を実AIで正しく構造化し、その出力が決定論的な後段処理まで通ることを確認する。

対象表現:

```text
英単語は2026年7月8日、10日、11日だけやりたい
英単語は毎週、水曜と金曜から日曜にやりたい
英単語は毎週、水曜と金曜から日曜。ただし2026年7月25日はやらない
数学は2026年7月8日、10日、11日だけ、英単語は毎週水曜と金曜から日曜
英単語は2026年7月8日、10日、11日はやらない
```

## 評価する導線

```text
GitHub Models
→ V5 alpha2 strict JSON Schema
→ runtime validator
→ semantic canonicalizer
→ PlanningFactGraph V2
→ task date rule resolver
→ metric判定
```

単にJSONとして正しいかだけでなく、次を判定する。

- 非連続日を連続rangeへ潰さない
- 3件のallowed/excluded dateを保持する
- `水曜と金曜から日曜`を`wed, fri, sat, sun`へ展開する
- recurrenceを対象taskへ付ける
- 複数task間で条件を取り違えない
- exact除外日を曜日候補から差し引く
- canonicalizationが成功する
- resolverが具体的日付集合を生成する
- recurrence由来候補とexact除外を誤ってconflict扱いしない

## 実装

追加ファイル:

- `src/features/weeklyPlanning/semantic/weeklyPlanningSemanticV2Date.real-eval.test.ts`

workflow:

- `.github/workflows/weekly-planning-semantic-schema-eval.yml`
- `GITHUB_MODELS_TOKEN=${{ secrets.GITHUB_TOKEN }}`
- permissions: `models: read`
- report: `artifacts/weekly-planning-semantic-v2-date-real-eval.json`

## 実行結果

### real-eval harness

- commit `d409e3f`
- full TypeScript success
- Vite production build success
- 通常buildへ戻したcommit `de88c3c`でもsuccess

したがって、評価コードとV5内部導線の型・build整合は確認できた。

### GitHub Actions

- workflow run: `29914817961`
- conclusion: failure
- job: `real-eval`
- steps: 0件
- job log: 生成されず

runnerがstepを開始する前に失敗しており、GitHub Modelsは呼ばれていない。これはAI出力の不合格ではなく、実行基盤の失敗である。

### Cloudflare Pages代替経路

値を出さず、次のいずれかの資格情報が存在する場合だけbuildを成功させる診断を行った。

- `OPENAI_API_KEY`
- `GITHUB_MODELS_TOKEN`
- Cloudflare AI proxy URLとFirebase ID tokenの組

診断commit `b4032e9`はbuild failureとなったため、Pages環境には安全にreal-evalを実行できる資格情報がない。診断後、`package.json`は通常buildへ復元した。

## 現時点の結論

確認済み:

- AIへstrict V5 schemaを渡す実装
- AI返答のruntime validationと1回repair
- valid documentからcanonical fact graphへの変換
- 非連続日・曜日集合・例外日の決定論的解決
- real-eval harnessの型・build整合

未確認:

- 実AIが5ケースを意味的に正しく出力するか
- 5ケースのpass率
- repairが実APIで必要になる頻度

理由は、利用可能な実AI資格情報がなく、GitHub Actions runnerもstep開始前に失敗したためである。

## production接続状況

新V5内部導線はmodule間では接続済みである。

```text
semantic normalizer
→ validator
→ canonicalizer
→ fact graph
→ availability / commitment / task-date resolver
→ generic scheduler input
→ dialogue policy / preview gate
```

ただし次は未接続である。

- productionの会話handlerからV5 normalizerを呼ぶ入口
- 現行schedulerへgeneric scheduler inputを渡すadapter
- preview、repository、UI、保存への出口

したがって、現在は「V5を直接呼べば内部処理できる基盤」であり、「通常のアプリ利用が自動的にV5を通る状態」ではない。

## 次の実行条件

次のどちらかが解消した時点で、同じharnessをそのまま実行する。

1. GitHub Actions runnerがstepを開始できる状態になる
2. `OPENAI_API_KEY`または評価用Firebase ID tokenを安全な実行環境へ設定する

実AI結果が取得できるまで、V5 semantic pathをproduction採用済みとは扱わない。
