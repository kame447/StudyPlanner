# 週間計画 汎用意味モデル Stable V5 ロードマップ

Status: canonical / Phase 4 semantic refactor
最終更新: 2026-08-11

- Main roadmap: [weekly-planning-roadmap.md](weekly-planning-roadmap.md)
- Current status: [../weekly-planning-current-contract-status.md](../weekly-planning-current-contract-status.md)
- Test philosophy: [../testing/weekly-planning-test-philosophy.md](../testing/weekly-planning-test-philosophy.md)
- Execution sequence: [../tasks/20260811-weekly-planning-merge-cleanup-refactor-sequence.md](../tasks/20260811-weekly-planning-merge-cleanup-refactor-sequence.md)

## 0. 非交渉の責務境界

ユーザー発話と会話文脈の意味理解はAIが担当する。

```text
user utterance + relevant conversation + machine-readable state
→ focused または generic AI semantic interpretation
→ structural / evidence / reference validation
→ formal binding / canonical commit
→ Fact Graph V5
```

禁止:

```text
user utterance
→ regex / keyword / dictionary / deterministic parser
→ AI意味の置換・補完・上書き
```

focused routeでも意味解釈はfocused AIが担当する。deterministic routerはpending question、runtime phase、target fact等のmachine stateだけでrouteを選ぶ。

## 1. 現行semantic path

```text
machine-state routing
├─ focused authorization AI
└─ generic semantic AI
   → response normalization / validation chain
   → structural/reference violation時のみAI repair最大1回
→ accepted current-turn SemanticDocument
→ existing entity binding
→ correction / no-opを含むcanonical commit transaction
→ Fact Graph V5
→ scheduler / readiness / dialogue
```

SemanticDocumentはcurrent-turn deltaであり、accepted state snapshotではない。publicStateSummary / recentConversationは意味解釈contextであり、過去Factをcurrent deltaへ再コピーする根拠ではない。

## 2. 現在確定しているsemantic contract

- workloadをeffort estimateのformal targetにできる。
- current-turnに根拠のない過去Factコピーをvalidatorで拒否する。
- pending answerをformal targetへbindingする。
- quantity semanticsの構造矛盾はvalidatorで検出し、必要時だけAI repairへ返す。
- no-op semantic turnでFact revisionを増やさないがidempotency履歴は保持する。
- 標準曜日・日付・時間帯の意味構造化はAIが行う。
- creation authorizationはAIが意味判定する。
- renderer文面をsemantic stateへ逆利用しない。

## 3. prompt / orchestration

巨大なgeneric promptへ責務を積み続けない。

既存の作成許可focused routeではgeneric semantic約25KB級に対し約1.3KB級までrequestを縮小できた実測がある。ただしfocused route拡大はbehavior changeなのでPhase 4では行わない。

promptへ新規規則を追加する前に次を確認する。

1. 既存promptが長すぎて指示を落としていないか。
2. 責務を別AI semanticへ分離すべきか。
3. schema表現力不足か。
4. validator / binding / state handoffの問題か。

prompt budget上限を緩めて肥大化を隠さない。

## 4. 完了済みlegacy cleanup

PR #112で次を削除済み。

- old AI interpreter
- parser fallback
- semantic V1/V2 experiment cluster
- runtime selector / old runtime branch
- fixed scenario semantic quality oracle / model comparison infra
- production-unreachable semantic/cutover prototypes

現在残るmigration decoderやtrace read compatibilityはold semantic runtimeではない。

## 5. 現在のPhase 4 semantic refactor

挙動を変えず責務をmodule境界へ反映する。

完了済みbatch:

- historical `SemanticValidatorLegacyV5` → current base validator命名へ整理
- generic semantic prompt assemblyをnormalizerから分離
- focused authorization schema/prompt/eligibility/parserを専用semantic moduleへ分離
- generic response normalization + validation chainをnormalizerから分離
- repair directive / repair prompt生成をnormalizerから分離
- existing entity binding + correction + no-op collapseをsemantic commit transactionへ分離
- AIへ渡すactive public facts / correction context生成をpipelineから分離

変更していないもの:

- focused route eligibility
- semantic promptsの意味規則
- validator accept/reject policy
- repair最大1回
- canonicalization semantics
- Fact revision/idempotency
- scheduler/readiness

## 6. Phase 4完了gate

- semantic normalizerがprovider orchestrationとdiagnostics中心になっている。
- prompt assembly、focused semantics、response validation、repair、public state、canonical commitが追跡可能なmoduleへ分離されている。
- prompt budgetが悪化していない。
- focused/generic routeの意味責務がAIに残る。
- deterministic codeがraw Japaneseを意味解析していない。
- current-turn evidence / existing entity / correction / no-op回帰がgreen。
- typecheck / foundation / full Vitest / build / diff checkがgreen。
- 7視点最終監査でBLOCKER/MAJORなし。

## 7. Phase 5 semantic再棚卸し

refactor merge後mainを次の観点でゼロベース監査する。

1. AI semantic ownershipが破られていないか。
2. focused/generic routeがmachine stateだけで決まるか。
3. context過多・不足・古いstate混入がないか。
4. schemaがAIの意味を損失なく表現できるか。
5. validatorが意味を選び直していないか。
6. repairが指摘範囲外の意味を変更していないか。
7. request size、repair率、latency、traceからorchestration分割の効果を評価できるか。

## 8. Phase 5後に再評価する候補

- partial semantic acceptance
- unresolved fact / ambiguity ID
- clarification transaction
- resolved-only scheduler view
- focused semantic route追加
- model escalation policy
- evidence coverage registry

古いroadmapに存在したという理由だけで着手しない。

## 9. failure investigation protocol

実APIで問題が出た場合は次の順で確認する。

```text
AI route / input context
→ AI raw semantic meaning
→ schema表現可能性
→ response validation
→ AI repair
→ formal binding
→ canonical commit / no-op / revision
→ readiness / scheduler / dialogue / renderer
→ preview / approval / save
```

この順序を確認する前に自然言語ルールを追加しない。
