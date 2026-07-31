# 外部予定sourceをproduction adapterへ接続する

Status: active / pure loader verified, production adapter not connected
Priority: P2
Created: 2026-07-28
Updated: 2026-07-31
Depends on: `closed/20260722-weekly-planning-external-source-atomic-retry.md`

## 現在地

実装・自動検証済み:

- atomic `success(events) | failure(reason)`
- empty successとfailureの区別
- partial result非公開
- bounded retry
- owner mismatch・不正eventのsource単位reject
- failure時のconversation/accepted Fact維持
- source failureを予定0件としてpreviewへ進めない

未接続:

- production calendar repository/API adapter
- pagination完走
- auth refreshとpermission error分類
- timeout/rate-limit/server error metrics
- private event本文をAI/quality traceへ渡さない境界
- browserでの0件、認証切れ、再試行、復旧

## Adapter contract

- 対象期間全体の取得成功時だけ`success(events)`を返す
- page途中失敗では取得済みpartial eventsをschedulerへ渡さない
- retry後も同じrequest/source identityを使う
- duplicate eventをdeterministic identityへ収束
- owner、date range、shapeをauthoritative boundaryで検証
- raw token、calendar ID、private本文をtraceへ保存しない
- adapter failureでplanning sessionをresetしない

## 完了条件

- [ ] production adapterをrepository boundaryへ接続
- [ ] paginationをatomicに完走
- [ ] auth refresh/error categoryを実装
- [ ] retry/latency/failure metricsを追加
- [ ] owner/date/shapeを検証
- [ ] AI prompt/traceへprivate本文を漏らさない
- [ ] focused/full/typecheck/build/diff checkがgreen
- [ ] browserで0件、timeout、認証切れ、paginationを確認
- [ ] operational runbookを更新