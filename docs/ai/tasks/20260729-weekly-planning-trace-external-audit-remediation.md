# 週間計画trace 外部監査指摘の是正

## 状態

In progress

## 対象

- Issue #89
- PR #97
- Branch: `agent/trace-log-schema-simplification`

## 目的

週間計画traceを、障害原因を後から特定できる十分な情報を維持しつつ、ブラウザ・Worker・Firestoreへ不要なCPU、メモリ、read/write負荷を与えない構造へ修正する。

## 外部監査で確定した未解決事項

1. 保存前に巨大データを何度も複製している
2. 障害解析に必要なscheduler・preview情報を永続ログへ保存していない
3. AI生出力を先頭側だけで切り捨て、欠落範囲と末尾を確認できない
4. error、outcome、assistant response sourceを実際の分岐どおり分類できていない
5. 501件目以降のentryを管理画面が黙って取得対象外にする
6. stale filterなどの管理画面操作が全sessionの大量取得を発生させる
7. trace保存失敗時に診断情報を再送できず消失する

## 完了条件

### 1. 取得前projection

- debug collectorへ渡された巨大Graph、全予定、全時間割、scheduler input/result、preview input/resultをそのままcloneしない
- stageごとに許可した小さい診断projectionだけをrequest-local collectorへ保存する
- collector内の1 eventと1 request全体にbyte・件数上限を設ける
- 上限超過は明示的なtruncation metadataとして残す

### 2. scheduler / preview観測性

1 turn diagnosticから次を確認できること。

- selectedDateとtimeZone
- planning horizonと解決元
- external sourceごとのstatus、failure kind、event count
- scheduler compilation status
- blocking issue code、domain、fact ID、blocking判定
- dialogue statusと選択質問code
- preview scheduler version、status、候補数、未配置数、代表配置
- duplicate suppressionの有無

### 3. AI生出力

- 上限内なら全文を保存する
- 上限超過時は先頭・末尾、元byte数、checksum、truncated=trueを保存する
- validation失敗原因となる末尾を失わない
- testの期待値を実契約と一致させる

### 4. 分類

- AIが生成した応答、rules/coreが生成した応答、system failure、deterministic fallbackを区別する
- provider failure、normalization rejection、canonicalization rejection、runtime throwをerrorとしてsession metadataへ反映する
- outcome、error code、response sourceを同一branch情報から決定する

### 5. entry上限

- 取得可能上限を超えるsessionを正常な全件取得として返さない
- totalEntryCount、retrieved count、truncated/unsupported countを明示する
- 部分timelineを完全なRaw JSONとしてexport・archiveしない

### 6. 管理画面負荷

- stale filterで全sessionを同時取得しない
- session展開時は必要ページだけ取得する
- export時だけ逐次全ページ取得し、並列集中を避ける
- pageごとの認証・監査write回数を必要最小限にする

### 7. 保存失敗耐性

- 失敗したcompact diagnostic inputをbrowser persistent outboxへ保存する
- 次回起動・次turnで古い順に再送する
- request IDとsequenceのidempotencyを維持する
- outbox件数・byte上限とoverflow診断を設ける

## 検証gate

- focused trace tests
- full test suite
- `npm run typecheck`
- `npm run typecheck:build`
- `npm run build`
- diff check
- 2 turn / 100 turn / 500+ entry / large AI response / many busy intervals / write failure and reload recovery
- Worker CPU、Firestore read/write、admin request数のProduction確認

## close条件

上記7項目の実装・回帰test・検証が完了し、PR #97のProduction確認まで成功した場合にのみ、このファイルを`docs/ai/tasks/closed/`へ移動し、Issue #89をcloseする。
