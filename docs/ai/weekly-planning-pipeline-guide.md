# weeklyPlanning task and validation guide

Status: **active**
最終更新: 2026-08-14

## 1. Read order

1. [documentation index](weekly-planning-docs-index.md)
2. [current contract v5](weekly-planning-current-contract-v5.md)
3. [current contract status](weekly-planning-current-contract-status.md)
4. [dialogue architecture v5](../architecture/weekly-planning-dialogue-architecture-v5.md)
5. [roadmap](strategy/weekly-planning-roadmap.md)
6. [test philosophy](testing/weekly-planning-test-philosophy.md)
7. 対象の`docs/ai/tasks/*.md`

旧architecture、旧strategy、legacy runtime、固定scenario eval文書はhistorical sourceであり、current instructionとして使用しない。

## 2. Responsibility boundary

```text
raw user utterance / conversation context
  → AI semantic interpretation
  → validated typed semantic delta
  → deterministic formal binding / Fact Graph lifecycle
  → deterministic readiness / question priority / scheduling policy
  → deterministic preview / approval / save boundary
  → typed dialogue decision
  → AI renderer for natural user-facing wording
```

### AI owns

- raw natural languageの意味理解
- conversation contextに基づく短答・訂正・authorization intentの解釈
- task / workload / quantity role / date / weekday / time-period等の構造化
- typed semantic candidateの生成
- 必要時のsemantic repair（最大1回）
- deterministic codeが決定済みのdialogue actionの自然な文章化

### Deterministic code owns

- schema / reference / evidence validation
- formal ID / revision / idempotency
- Fact Graph lifecycle / canonical commit
- confirmationの必要性、質問優先度、進行方針
- readiness / scheduler / placement safety
- preview freshness / approval / save
- persistence / recovery / trace safety

### Prohibited ownership inversion

- raw Japanese textをregex / keyword / dictionary / legacy parserで再解釈し、semantic truthを決めない。
- provider failureやvalidation failureから旧natural-language parserへfallbackしない。
- rendererの日本語文面からmachine state、pending target、authorizationを逆推定しない。
- AIにformal lifecycle、scheduler placement、approval、saveを決定させない。

hard constraint、existing plans、timetable、buffer等のmachine-owned constraintはsemantic AIへ意味判断として委譲せず、deterministic scheduler境界で維持する。

## 3. Task lifecycle

- `docs/ai/tasks/`直下には未完了taskだけを置く。
- 1 task = 一つの責務または一つのvertical slice。
- 完了taskはrootから除去し、必要な結果だけ`tasks/closed/`のcompletion recordへ統合する。
- superseded taskは`tasks/superseded/`へ置く。
- historical文書から直接taskを再開しない。current contractと最新コードを再調査してから現在のwork unitへ接続する。
- 古いtaskの`Status: active`だけを根拠に実装を再開しない。

## 4. Required task sections

- Status / Priority
- Requirement IDs
- Dependencies / Entry / Exit
- current production path
- exact types and state transitions
- AI / deterministic ownership boundary
- validator and failure behavior
- stale / concurrency / persistence / security
- non-goals
- acceptance criteria
- targeted tests
- full tests / typecheck / build / diff check
- browser / real-API verificationが必要な場合はその結果とhuman-review境界

## 5. Test audit rule

テスト失敗は原因を分類して扱う。

1. implementation defect → production codeを修正する。
2. stale / incorrect test contract → current contractを確認してtestを修正する。
3. harness boundary issue → harnessを修正する。

Green化だけを目的にregressionを削除・弱体化しない。AIの特定日本語文面や固定semantic outputを唯一の正解として固定しない。

## 6. Validation

原則として次を実行する。

```bash
npx vitest run <targeted test files>
npm run typecheck
npm run test:run
npm run build
git diff --check
git status -sb
```

ブラウザ確認が必要なtaskではbrowser regressionを使用する。AI意味理解・自然さ・real API output varianceはhuman-reviewed observationとして扱い、自動テストではschema、binding、Fact Graph、readiness、scheduler、preview、approval、save等の決定論的contractを主に保証する。

## 7. Git operation

同じlogical taskでは既存Issue / branch / PRを再利用する。CI修正やレビュー対応だけを理由に新しいbranch / PRを増やさない。

タスクmdに明示されていない限り、ローカル実装担当はgit add、commit、push、merge、rebaseを行わない。GitHub connector等を通じて明示的に同一作業branchへ変更する場合も、作業前に既存Issue / branch / PRとの重複を確認する。
