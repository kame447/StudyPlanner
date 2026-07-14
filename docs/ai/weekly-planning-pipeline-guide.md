# weeklyPlanning task and validation guide

Status: **active**
最終更新: 2026-07-14

## 1. Read order

1. [documentation index](weekly-planning-docs-index.md)
2. [product spec](../weekly-planning/weekly-planning-spec.md)
3. [architecture v4](../architecture/weekly-planning-dialogue-architecture-v4.md)
4. [roadmap](strategy/weekly-planning-roadmap.md)
5. [roleplay / contract plan](../testing/weekly-planning-roleplay-test-plan.md)
6. 対象の`docs/ai/tasks/*.md`

旧architecture、旧strategy、旧testing設計はcurrent instructionとして使用しない。

## 2. Responsibility boundary

```text
AI interpreter
  → typed candidates
validator / adapter / reducer
  → accepted state / pending proposal
behavior core
  → readiness / hypothesis / allowed actions
AI dialogue planner
  → validated user-facing response
preview gate
  → existing scheduler
preview
  → explicit UI approval
save
```

- AIはstate、scheduler、save、approve、deleteを直接変更しない。
- user textはtyped candidateとvalidatorを通す。
- previewはauthorizationとreadiness gate通過後だけ生成する。
- hard constraint、existing plans、timetable、bufferを維持する。
- scope外の問題は修正せず報告する。

## 3. Task lifecycle

- `docs/ai/tasks/`直下には未完了taskだけを置く。
- 1 task = 一つの責務または一つのvertical slice。
- 完了taskはrootから除去し、必要な結果だけ`tasks/closed/`のcompletion recordへ統合する。
- superseded taskは`tasks/superseded/`へ置く。
- historical文書から直接taskを再開しない。最新コードを再調査して新しいtaskを作る。

## 4. Required task sections

- Status / Priority
- Requirement IDs
- Dependencies / Entry / Exit
- current production path
- exact types and state transitions
- validator and failure behavior
- stale / concurrency / persistence / security
- non-goals
- acceptance criteria
- targeted tests
- full tests / typecheck / build / diff check

## 5. Validation

原則として次を実行する。

```bash
npx vitest run <targeted test files>
npx tsc --noEmit
npm run build
npm test -- --run
git diff --check
git status -sb
```

ブラウザ確認が必要なtaskでは、roleplay test planのscenarioを使う。自動ブラウザ環境が不安定な場合は、コード変更を続けず、未実施理由とserver/browser logだけを報告する。

## 6. Git operation

タスクmdに明示されていない限り、実装担当はgit add、commit、push、merge、rebaseを行わない。検証専用依頼ではファイル変更を行わない。
