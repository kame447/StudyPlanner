# 週間計画trace 外部監査指摘の是正

## 状態

Implementation complete / Verification pending

## 対象

- Issue #89
- PR #97
- Branch: `agent/trace-log-schema-simplification`
- Initial implementation head: `0947c3a552709b86923c85b8ecedc69abd047331`
- Regression remediation head: `5b2a19e94400694a743399875ce535654dffaa17`

## 目的

週間計画traceを、障害原因を後から特定できる十分な情報を維持しつつ、ブラウザ・Worker・Firestoreへ不要なCPU、メモリ、read/write負荷を与えない構造へ修正する。

## 外部監査で確定した事項と実装結果

### 1. 保存前に巨大データを何度も複製していた

実装済み。

- request-local collectorをstage別allowlist projectionへ変更
- Graph全体、全予定、全時間割、scheduler/previewの巨大input/resultをcollectorへ保持しない
- `scheduler_compilation_evaluated`、`runtime_semantic_result_received`、`runtime_graph_staged`も専用projectionへ変更
- 未登録stageはgeneric cloneせず、stage名と利用可能keyだけを記録
- 1 event 32KB、1 request 128KB、64 eventsの上限を設定
- 上限超過を`trace_collector_truncated`とdiagnosticのtruncation metadataへ記録

### 2. scheduler・preview情報が不足していた

実装済み。

1 turn diagnosticへ次を追加した。

- selectedDate、timeZone、planning horizon
- external sourceごとのstatus、failure kind、event count
- compilation statusとblocking issueのcode/domain/fact ID
- dialogue statusとselected question code
- preview scheduler version、status、candidate count、unscheduled count、代表候補
- duplicate suppression

### 3. AI生出力を先頭だけで切り捨てていた

実装済み。

- 上限内は全文保存
- 上限超過時はhead、tail、original byte count、checksum、`truncated=true`を保存
- JSON末尾やvalidation失敗位置を確認可能にした
- provider requestは通常サイズの実送信promptを維持し、上限超過時だけhead-tail化する
- repair requestはinvalid responseとvalidation errorを別途保持する
- 旧「1万文字を全文保存」testをhead-tail契約へ更新

### 4. error・response sourceを誤分類していた

実装済み。

- deterministic fallback、system failure、rules/core responseを分離
- provider failure、normalization rejection、canonicalization rejection、runtime throwをsession `hasError`へ反映
- duplicate suppression、stale disposal、failure responseを`system`として記録

### 5. 501件目以降を黙って取得対象外にしていた

実装済み。

- Workerの実件数上限をstorage契約と同じ100,000へ変更し、500へ丸めない
- 管理画面の部分表示へloaded count、total count、partial flagを表示
- 全件collectorは500件を超えてcursorが残る場合に明示的に失敗
- entry数がsession metadataと一致しない場合はexport・archiveしない

### 6. 管理画面が大量リクエストを発生させていた

実装済み。

- stale filterによる全sessionの`Promise.all`取得を削除
- session展開時は最初の20件だけ取得
- 追加取得は利用者が「さらに20件読み込む」を押した場合だけ実行
- export時だけ単一sessionを逐次取得
- 未読sessionはstale filterのために暗黙取得しない
- 各明示page accessは従来どおり認証・access audit対象とし、不要な背景page access自体を発生させない

### 7. 保存失敗時にログが消失していた

実装済み。

- browser persistent outboxを追加
- 失敗したcompact inputを最大10件・1件192KB・合計1MBで保持
- 次回turnまたは再読込後に古い順で再送
- 成功後にだけsequence、turn count、request IDをcommit
- outbox overflowをconsole diagnosticsへ明示

## legacy互換

新規schema v2の書込み削減と、schema v1の読取り互換を分離する。

- `approval_item_saved`、`approval_item_failed`、`trace_write_failed`などの既存event allowlistを維持
- schema v1のBase64 chunk encode/decode helperをread/export互換専用として維持
- schema v2の新規書込みではBase64 chunkを生成しない
- in-memory repositoryは`turn_diagnostic`をstate snapshotと誤認せずcloneする

## 追加・更新test

- bounded stage projectionと巨大Graph非保存
- heavy runtime stageからGraph・scheduler input全体を除外
- provider promptの必要箇所とuser promptを保持
- AI raw responseのhead-tail、original bytes、checksum
- scheduler source、issue、dialogue、preview情報
- rules/system response source分類
- provider failureのsession error反映
- 48KB document上限とtruncation metadata
- 500件超の部分export拒否
- legacy chunk export互換
- approval item eventとwrite failure event互換
- write failure後のpersistent outbox再送
- reload後も同一session、sequence 0から再開
- stale disposalとduplicate suppression
- Stable V5 production import boundaryへtrace support moduleを明示登録

## 2026-07-29 ローカル検証結果と是正

利用者環境の全Vitest実行では、変更前headに対して次の結果だった。

- Test Files: 6 failed / 238 passed / 7 skipped
- Tests: 7 failed / 1696 passed / 19 skipped / 5 todo
- Vite production build: passed

確認された失敗と是正:

1. preview eventの旧nested expectationをcompact projectionへ更新
2. provider requestで必要なsystem prompt末尾が失われる問題をhead-tail保持へ修正
3. trace outbox / diagnostic moduleをaudited Stable V5 importerへ追加
4. legacy Base64 chunk export helperを復元
5. approval item event allowlistを復元
6. `trace_write_failed` event allowlistを復元
7. heavy runtime stageがGraph全体を保持する経路を専用projectionへ変更

この是正後のfocused/full test、typecheckは再実行待ちであり、成功扱いにはしない。

## GitHub上で確認できた検証

- Cloudflare Pages source build: commit `5b2a19e94400694a743399875ce535654dffaa17` で成功
- GitHub Actionsはrunner jobのstep開始前にfailureとなり、step/logが存在しない
- GitHub上ではローカルtypecheck、full test、Worker deploy、Production負荷確認を実行していない

## 未完了の検証gate

- focused trace tests再実行
- full test suite再実行
- `npm run typecheck`
- `npm run typecheck:build`
- `npm run build`再実行
- Worker deploy
- 2 turn / 100 turn / 500+ entry / large AI response / many busy intervals / write failure and reload recovery
- Worker CPU、Firestore read/write、admin request数のProduction確認

## close条件

実装は完了したが、検証gateとProduction確認は未完了である。このファイルはまだ`docs/ai/tasks/closed/`へ移動せず、Issue #89もopen、PR #97もDraftを維持する。

上記検証がすべて成功した場合にのみ、このファイルを`docs/ai/tasks/closed/`へ移動し、Issue #89をcloseする。
