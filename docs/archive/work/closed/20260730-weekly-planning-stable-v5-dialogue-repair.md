# Stable V5の認識済みタスク再質問と構造化repair失敗を修正する

Status: closed / implementation and regression coverage complete; automated Actions verification blocked before job steps
Created: 2026-07-30
Closed: 2026-07-30
Issue: #98
PR: #99
Branch: `agent/stable-v5-dialogue-repair-seven-audit`
Audit: `docs/ai/audits/20260730-weekly-planning-stable-v5-dialogue-repair-seven-audit.md`
Source trace: `weekly-trace-fbda7e10-9506-590c-bac3-1c56629613d2`
Follow-up: #100

## 結論

Production traceで確認した二つの表面不具合に対する実装修正と回帰test追加は完了した。

認識済みtaskが存在するのにscheduler compilationが`empty`となる場合、従来は固定の一般質問を再送していた。修正後はactive Fact Graphのtask名を示し、未入力の作業量だけを質問する。taskが0件の初回一般質問は維持した。

semantic repairでは、priorityを時間制約へ変換しないこと、利用者が述べていないclockを発明しないこと、`missing-start`または`missing-end`に明示clock根拠がなければunsupported constraintを削除または適切なkindへ変更すること、named periodとclockを同時に残さないことをbase promptとrepair instructionへ追加した。

normalization rejected時の利用者向け文言は、「内容を少し言い換えて」から、入力内容を保持したまま内部の構造化処理に失敗したことを示し、同じ内容をそのまま再送できる文言へ変更した。

## 変更ファイル

- `src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5.ts`
- `src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5.test.ts`
- `src/features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeExecutor.ts`
- `src/features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeExecutor.test.ts`
- `docs/ai/audits/20260730-weekly-planning-stable-v5-dialogue-repair-seven-audit.md`

## 回帰test

追加したtestは、taskが0件なら従来の一般質問を維持すること、taskが2件でworkloadが0件ならtask名を含む不足質問へ進むこと、compatibility stateへ`missing_schedulable_work`を記録すること、normalization failureで「言い換えて」を返さないことを固定する。

normalizer testは、priority由来の不正な`earliest_start`が`missing-start`となった後、repairがclockを発明せずtemporal constraintを除去し、priority relationを保持したdocumentをattempt 2でacceptedにできる契約を固定する。

## 七視点監査結果

アーキテクチャ、schema/validator/repair契約、状態原子性、対話UX、観測性、test・GitHub hygieneについて、Issue #98の範囲では修正済みと判定した。

Scheduler意味保持の監査では、task-specific `preferred_window`がFact Graphへ保存されてもpreview配置へ反映されない別問題を発見した。この問題はIssue #100へ切り出し、PR #99へ混在させていない。

## 検証結果

PR #99はmainからbehind 0で、GitHubはmergeableと判定している。変更範囲は6ファイルである。

Cloudflare PagesはPR head `9d5f0f5c9318c50474e25ca2ce8088146891e152`のpreview deploy成功を報告した。production bundleのbuild経路が成立した証拠として扱う。

GitHub Actions CI run `30477837167`とStable V5 Semantic Eval run `30477837139`はfailureで終了した。ただし各jobはstepが0件で、job logも生成されていない。既知のActions月間枠枯渇と整合し、コードまたはtestを実行して失敗した証拠ではない。同時に、focused test、full test、typecheck、typecheck:build、diff checkの成功証拠もない。

ローカル環境は使用しておらず、ローカルtestは実行していない。したがってPR #99はdraftのまま維持し、merge前に人間のローカル環境またはActions枠復旧後に次を実行する必要がある。

```bash
npm run typecheck
npm run test:run
npm run build
git diff --check origin/main...HEAD
```

## 残余リスク

repair規則はmodelへの一般化された指示強化であり、すべてのprovider出力を決定論的に修復するものではない。validatorによるfail-closedは維持される。

task-aware不足質問へ短い量だけで回答した場合の既存taskへの決定論的bindingは今回追加していない。今回の質問はtask名と量を含む回答を促すが、この対話契約を強化する場合は別タスクとして扱う。

## PR状態

PR #99は実装レビュー可能だが、自動verification未完了のためdraftである。Issue #98はPR merge時にcloseされる。過去PRは調査時点ですべてclosedで、追加のclose操作は不要だった。
