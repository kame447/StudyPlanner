# 外部予定sourceをproduction adapterへ接続する

Status: active / pure loader verified, production adapter not connected
Priority: P2
Created: 2026-07-28
Depends on: `closed/20260722-weekly-planning-external-source-atomic-retry.md`

## 1. 現在地

実装・自動検証済み:

- `success(events) | failure(reason)`のatomic result
- empty successとfailureの区別
- partial resultを上位へ公開しない
- temporary failureのbounded retry
- authentication/permission/not-configured/invalid-responseの非retry
- owner mismatch・不正eventのsource単位reject
- failure時にconversationとaccepted factsを維持
- source要求中のfailureを予定0件として黙ってpreviewへ進めない

未接続:

- production calendar repository/API adapter
- pagination完走
- auth refreshとpermission errorの実環境分類
- timeout/rate-limit/server error metrics
- actual existing-event本文をAIへ渡さないprivacy boundary
- browserでの0件、認証切れ、再試行、復旧

## 2. Adapter contract

各adapterは対象期間全体の取得に成功した場合だけ`success(events)`を返す。

```text
page 1 success
page 2 failure
→ failure(reason)
→ page 1 eventsをschedulerへ渡さない
```

- pagination cursorはadapter内部で完走する
- retry後も同じrequest/source identityを使う
- duplicate external eventsをdeterministic identityで収束させる
- owner、date range、event shapeをauthoritative boundaryで検証する
- raw provider token、calendar ID、private event本文をtraceへ保存しない
- adapter failureはplanning sessionをresetしない

## 3. Production verification

- event 0件の正常成功
- single page / multi page
- timeout後成功
- retry上限到達
- authentication expired
- permission denied
- source not configured
- invalid response
- owner mismatch
- duplicate page/event
- requested date range外event
- provider response loss後のretry

## 4. 完了条件

- [ ] production adapterをrepository boundaryへ接続
- [ ] paginationをatomicに完走
- [ ] auth refreshとerror categoryを実装
- [ ] retry/latency/failure metricsを追加
- [ ] source eventをscheduler inputへ渡す前にowner/date/shapeを検証
- [ ] AI promptとquality traceへprivate event本文を漏らさない
- [ ] focused/full/typecheck/build/diff checkがgreen
- [ ] browserで0件、timeout、認証切れ、paginationを確認
- [ ] operational runbookを更新

外部source未設定の環境で仮adapterや空配列へfallbackして完了扱いにしない。