# Stable V5 test suite consolidation and advanced testing audit

Date: 2026-07-31

Branch: `agent/stable-v5-tomorrow-dialogue-consistency`

PR: #107

## Scope

PR #107で追加・更新したStable V5のmachine pending question、planning-window repair、contextual short answer、AI renderer、trace永続化のテストを対象に、同じ契約を別fixtureで繰り返している回帰テスト、既存suiteへ統合できる専用test file、生成テストへ置換した方が強い固定例を確認した。

リポジトリ全体の全テストを機械的に削減する作業ではない。異なる境界のfailureを切り分けるために必要なunit、integration、transport/storage contractは維持する。

## Consolidated tests

`weeklyPlanningSemanticPendingQuestionPipeline.test.ts`は削除した。

同ファイルの「pending questionなしではrenderer文面だけからshort answerを既存Factへ結合しない」というintegration契約は、既存の`weeklyPlanningStableV5MultiTurnPipeline.test.ts`へ移した。positiveなexact-target結合は、同multi-turn suiteの実pipeline経路と、contextual binderのproperty-based testでより強く検証する。

`weeklyPlanningSemanticPlanningWindowPendingQuestion.test.ts`も削除した。

machine pending stateを使った`明日`のrepairと、pending stateがない場合に直前assistant文面だけを根拠にrepairしない契約は、既存の`weeklyPlanningSemanticNormalizerV5.test.ts`へ統合した。これによりnormalizerのinitial response、single repair、request payload、diagnosticsを同じfixtureとclient harnessで確認できる。

固定2-workloadだけを確認していたcontextual answer testは、fast-checkによるproperty-based testへ置換した。workload数2〜8とtarget indexを生成し、100ケースで、指定targetだけがsupersededになり、他のworkloadはactiveのまま、revisionは1だけ進み、replacementが対象Factのtask、amount、unitを保持することを確認する。

invalid pending questionの4ケースは個別に同じ関数を呼ぶ記述からtable-driven loopへまとめた。ここは異なる高水準の振る舞いではなく、同じ拒否契約へ到達する並列なinvalid inputである。

## Tests intentionally retained

`weeklyPlanningStableV5AiDialogueRenderer.test.ts`はrendererのJSON/action contractとgrounding validationを検証するunit suiteであり、semantic pipeline testとは責務が異なるため残す。

`weeklyPlanningStableV5RendererPromptTrace.test.ts`は実際にproviderへ送ったmessagesとtraceに回収されたmessagesの完全一致、およびprovider failure時のattempted prompt保持を検証する。renderer unit testだけではこの観測境界を保証できないため残す。

`weeklyPlanningRendererActionFallbackStorageContract.test.ts`はturn diagnosticのdocument size、persistent outbox、memory reset後のretry、semantic repairとrenderer fallbackの永続化を同時に通すstorage contract testである。`src/features/weeklyPlanning/AGENTS.md`のtrace persistence gateを満たすために必要であり、上記二suiteとは統合しない。

## Property-based testing decision

fast-checkは既にdevDependencyとして導入済みだったため、新しいdependencyは追加していない。

property-based testingは、特定の会話文を再現する回帰より、要素数やtarget位置が変わっても成立すべき不変条件に適する。今回の「pending questionが指定したFact以外を変更しない」は、固定例を増やすより生成したworkload集合に対して不変条件を検証する方が直接的である。

一方、provider prompt、利用者向け文面、特定のtrace shapeのように正確な契約値が重要な箇所はexample-based testを維持する。全testをproperty-basedへ移す方針は採らない。

Reference:

- https://fast-check.dev/docs/introduction/what-is-property-based-testing/
- https://fast-check.dev/docs/tutorials/setting-up-your-test-environment/property-based-testing-with-vitest/

## Mutation testing pilot

StrykerJSのpilotを`stryker.config.mjs`と`npm run test:mutation:weekly-planning`として追加した。

初期対象は次の二ファイルだけである。

- `weeklyPlanningPendingQuestionV5.ts`
- `weeklyPlanningStableV5ContextualAnswer.ts`

この二つはPR #107のmachine contractの中核であり、条件式、revision比較、targetFactId検証、lifecycle更新のmutationが生存した場合に、現在のtestが実装詳細を十分に拘束できていないことを直接示す。

全repositoryを対象にしない。mutation testingは通常testより高コストであり、最初から1700件超のsuite全体へ適用すると実行時間と解析負荷が大きい。Vitest runnerの`related`を有効にし、TypeScript checkerで型不成立mutantを実行前に除外し、incremental resultを保存し、concurrencyを2へ制限した。

thresholdはpilotとしてhigh 80、low 60、break 50にした。最初の実測前に通常CIの必須gateへは含めず、mutation score、survived mutant、実行時間を確認してから対象範囲とbreak値を調整する。

Stryker packageは通常のinstall dependencyには追加せず、scriptが同一versionのcore、Vitest runner、TypeScript checkerを一時取得する。pilotが継続運用に値すると確認できた段階でdevDependencyとlockfileへ固定する。

Reference:

- https://stryker-mutator.io/docs/stryker-js/vitest-runner/
- https://stryker-mutator.io/docs/stryker-js/typescript-checker/
- https://stryker-mutator.io/docs/stryker-js/incremental/
- https://stryker-mutator.io/docs/stryker-js/configuration/

## Other techniques considered

Model-basedまたはstate-machine testingは、cross-tab sequence、session復元、outbox lifecycleのように状態遷移数が増える領域では有用である。ただし今回変更したpending question binderは、machine stateを読み、単一turnで適用または拒否する境界であり、現時点でstate machine harnessを追加するとfixtureと抽象化の方が大きくなるため導入しない。

一般的なfuzz testも導入しない。単に「落ちない」ことより、どのFactだけが変化できるかというdomain oracleが重要であり、その目的は今回のproperty-based testで満たせる。

snapshot testも導入しない。Fact Graph、prompt、trace全体のsnapshotは差分の意味を隠しやすく、不要なfield変更まで承認させる危険がある。重要fieldを明示的にassertする現在の方式を維持する。

Vitest Test Projectsによるunit、integration、contractの実行分割も現時点では見送る。ファイル数の重複を解消する手段ではなく、設定と実行経路を増やすため、実測した実行時間または環境分離の必要性が出た場合に別途検討する。

## Verification

今回の変更後に次を実行する。

```bash
npm run typecheck

npm run test:run -- \
  src/features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeExecutor.test.ts \
  src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5DebugTrace.test.ts \
  src/features/weeklyPlanning/semantic/weeklyPlanningStableV5MultiTurnPipeline.test.ts \
  src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5.test.ts \
  src/features/weeklyPlanning/semantic/weeklyPlanningStableV5ContextualAnswer.test.ts \
  src/features/weeklyPlanning/dialogue/weeklyPlanningStableV5AiDialogueRenderer.test.ts \
  src/features/weeklyPlanning/dialogue/weeklyPlanningStableV5RendererPromptTrace.test.ts \
  src/features/weeklyPlanning/trace/weeklyPlanningRendererActionFallbackStorageContract.test.ts

npm run test:run
npm run build
git diff --check origin/main...HEAD
```

通常gateが成功した後、mutation pilotを別に実行する。

```bash
npm run test:mutation:weekly-planning
```

mutation pilotは初回scoreと実行時間が未計測のため、現時点では`npm run verify`へ含めない。

## Current verification status

この変更を行ったGitHub connector環境ではrepository checkoutとnpm package実行環境がないため、typecheck、Vitest、build、mutation runは未実行である。GitHub Actionsもjob開始前にsteps 0件で終了する既知状態であり、成功またはコード由来の失敗として扱えない。上記commandの実行結果を確認するまでPR #107はdraftのまま維持する。
