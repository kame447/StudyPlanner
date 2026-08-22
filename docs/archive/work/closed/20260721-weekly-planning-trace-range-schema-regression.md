# 週間計画traceの期間境界回帰

## 原因

週間計画runtimeは`planningRangeStart`/`planningRangeEnd`へ、次のドメイン値を格納する。

- `YYYY-MM-DD`
- `YYYY-MM-DDTHH:mm:ss`
- 日末境界の`YYYY-MM-DDT24:00:00`

一方、Workerのtrace schemaはこれらを監査時刻と同じ厳密なUTC ISO timestampとして検証していた。そのため`session/start`がFirestore書込み前に400となり、best-effort trace処理でエラーが画面へ出ず、管理画面では0件になっていた。

## 修正方針

- `startedAt`、`lastActivityAt`、`occurredAt`、`observedAt`等の監査時刻は厳密なUTC ISO timestampを維持する。
- `planningRangeStart`/`planningRangeEnd`だけを週間計画ドメイン境界として別検証する。
- 実在しない日付、25時、24時台の非ゼロ分秒、秒を欠く不完全形式は拒否する。

## 回帰テスト

- date-only、local datetime、24:00、UTC ISOを受理する単体テスト
- 不正日付・不正時刻を拒否する単体テスト
- 監査時刻の厳密性が緩まないことの単体テスト
- production形式でsession start→append→admin sessions→admin entriesを通すWorker結合テスト
- remote repositoryが期間境界をstart/append/admin変換で保持するテスト
