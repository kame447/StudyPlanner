# 週間計画mutation testing deferred record

Status: deferred / closed
Recorded: 2026-07-16

## 現状

Strykerは未導入であり、mutation testingは通常testまたはCIの一部ではない。現時点で実装queueへ入れる根拠とruntime計測がないため、仕様ディレクトリから外してdeferred recordとして保持する。

## 将来の限定候補

```text
src/features/weeklyPlanning/scheduling/sessionChunking.ts
src/features/weeklyPlanning/scheduling/placementScoring.ts
src/features/weeklyPlanning/parsing/weeklyTaskExtraction.ts
src/features/weeklyPlanning/parsing/weeklyQualityPreferenceParser.ts
```

## 再開条件

- 週間計画test suiteが安定している
- mutation runのruntimeとCI costを計測できる
- 対象moduleのfailure detection改善という目的が明確である
- `@stryker-mutator/core`とVitest runnerを限定scopeで導入する

## 再開時の制約

- 専用configと専用scriptを使用する
- React UI、repository、project全体を既定対象にしない
- runtime計測前にrequired CI gateへしない

本記録は将来候補であり、current product contractまたはactive implementation taskとして扱わない。
