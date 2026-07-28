# 週間計画trace Production保存障害の復旧

Status: active

Tracker: Issue #89

Branch: `agent/trace-production-recovery`

## Goal

ProductionのStable V5 traceについて、frontendとWorkerのversion skewを保存開始前に検出し、失敗stage・HTTP status・error category・correlation IDを安全に観測可能にする。appendはentry documentとsession metadataを原子的に確定し、管理画面ではraw、mapped、malformed、activity、empty、unexported、renderedの件数を分離する。

## Scope

`shared/weeklyPlanningTraceContract.ts`でcontract version、Worker revision、trace response headerを共有する。

frontend clientはhealth handshakeをsession start前に実行し、typed errorへstage、status、code、category、correlation ID、retryable、contract version、Worker revisionを保持する。

remote repositoryはnetwork、timeout、429、5xx等だけを一度retryし、validation、policy、auth、contract mismatchをretryしない。server handle rejectionだけはcanonical handleを再発行する。

Worker APIはhealth endpoint、typed error envelope、structured logを提供する。Firestore appendはentryとsession metadataを単一commitで保存する。

管理画面はempty sessionを通常一覧から除外したまま、診断件数とempty session表示を提供する。API errorと正常0件を同時表示しない。

feature flag未設定時はdevelopmentだけ有効、productionは無効として、configureとruntime repositoryの判定を統一する。

## Verification

`npm run typecheck`

`npm run typecheck:build`

`npm run test:run`

`npm run build`

`git diff --check origin/main...HEAD`

Worker deploy後は認証済みhealth、session start、小さい通常event、`stable_v5_debug_stage`、chunk payload、実アプリbatch、reload後append、raw admin sessions/entriesを順に検証する。

## Completion boundary

source実装とautomated testsがgreenでも、Worker deployとProduction browser検証が完了するまではIssue #89をcloseしない。
