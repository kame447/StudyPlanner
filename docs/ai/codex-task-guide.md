# Codex 実装ルール

Status: **active**

Codexは`docs/ai/tasks/*.md`の範囲だけを実装または検証する。current document setは[weekly-planning-docs-index.md](weekly-planning-docs-index.md)を正とする。

## 1. Scope

- task mdにない変更を広げない。
- non-goalsと触らない範囲を守る。
- 現実装とtaskが食い違う場合は、勝手に全面設計せず報告する。
- scope外の不具合は修正せず、再現条件と原因候補だけを報告する。
- 検証専用依頼ではファイル変更を行わない。

## 2. Architecture boundary

詳細は[weekly-planning-dialogue-architecture-v4.md](../architecture/weekly-planning-dialogue-architecture-v4.md)を正とする。

```text
AI interpreter
→ typed candidate
→ deterministic validator / adapter / reducer
→ behavior / readiness
→ allowed dialogue actions
→ validated dialogue response
→ preview gate
→ scheduler
→ unsaved preview
→ explicit approval
→ save
```

- AIはstate、scheduler、save、approve、deleteを直接変更しない。
- provider pathでAI resultとrules semantic parserをmergeしない。
- hard constraint、existing plan、timetable、bufferを維持する。
- previewはauthorizationとreadiness gate通過後だけ生成する。
- `shouldSavePlan: false`とunsaved preview境界を維持する。

## 3. Default protected areas

Task mdに明示されない限り、次を変更しない。

- `src/components/`とCSS
- repository / save path
- approval path
- schedulerの全面改修
- legacy transformsの全面置換
- `PlanningIntakeState`の破壊的変更
- dependency / lockfile

## 4. Git

Task mdまたはユーザーが明示しない限り、次を行わない。

- git add / commit / push
- branch作成・切替
- merge / rebase / reset / stash

## 5. Validation

```bash
npx vitest run <targeted test files>
npx tsc --noEmit
npm run build
npm test -- --run
git diff --check
git status -sb
```

Node環境の問題はコード不具合と分離する。必要な場合はrepository外の一時Nodeを使い、`node_modules`やlockfileを変更しない。

## 6. Report

1. 変更ファイルまたは「変更なし」
2. 実行command
3. targeted test結果
4. TypeScript / build / full test結果
5. failureのtest名、expected / actual、stack trace
6. browser確認結果
7. scope外の発見
8. final git status
