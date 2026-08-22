# 週間計画trace Production復旧 実装記録

対象Issue: #89

対象branch: `agent/trace-production-recovery`

## 実装した境界

frontendとWorkerの明示contract version、Worker revision、correlation ID headerをshared contractへ追加した。

remote repositoryはsession start前に認証済みhealth handshakeを実行する。旧Worker、contract mismatch、health未実装Workerに対してempty sessionを作成しない。

client errorはstage、HTTP status、error code、category、correlation ID、retryable、contract version、Worker revisionを保持する。consoleにはpayloadやtokenを出さず、安全なdiagnosticだけを単一文字列で出す。

retryはnetwork、timeout、429、5xx等のretriable errorに限定する。validation、auth、policy、contract mismatchはretryしない。server handle rejectionだけはcanonical handleを再取得する。

Worker appendはFirestore commitにentry create、session metadata update、entryCount maximum transformをまとめる。commit conflict時は同一entryとsession countを照合して、response loss後の同一retryだけを成功扱いにする。

admin UIはraw、mapped、malformed、activity、empty、unexported、rendered件数を分離し、empty sessionを診断表示できる。API error時は正常0件表示を出さない。

feature flag未設定時はdevelopmentだけ有効とし、productionは無効にする。configureとruntime repositoryの判定を同一関数へ統一した。

manual workflowとNode probeを追加し、deployed Workerのhealth、contract version、revision、correlation ID、storage layoutを検証できるようにした。

## 未完了境界

Cloudflare認証復旧、Worker deploy、認証済みCase 1からCase 5、Production browser 2turn/reload、raw admin sessions/entries、Firestore実documentの検証はdeploy後作業である。

これらが完了するまでIssue #89はcloseしない。
