# T-8: 週間計画traceのserver-authoritative structural ID

## 対象

PR #68の統括監査でM-8とされた項目を、修正計画上のT-8として独立実装する。

## 調査結果

### 問題の本質

電話番号形のfallback IDは反例であり、根本原因ではない。現在のブラウザruntimeは`sessionId`と`logicalConversationId`を生成し、append APIへ送る。サーバーは形式と親子関係を検証するが、未知のclient-supplied `sessionId`からFirestore session documentを新規作成し、clientのentry IDをdocument pathとして採用する。

認証済みユーザーはブラウザruntimeを経由せずappend APIを直接呼べるため、形式を満たす任意UUIDをcanonical IDとして作成できる。fallback形式から電話番号だけを除外しても解消しない。

### 既存の防御

- production起動時は`configureWeeklyPlanningTraceRepository()`がremote API repositoryを選択する。
- Firestore rulesはtrace session、entry、access auditへのclient read/writeを拒否する。
- したがって、修正対象はworkerのsession発行・append契約と、remote repositoryのhandle変換である。

## 採用設計

1. `POST /weekly-planning-trace/session/start`を追加する。
2. サーバーは認証UID、epoch secret、clientの非権威idempotency keyからcanonical `sessionId`と`logicalConversationId`をHMACで決定する。
3. client correlation keyのraw値はFirestore path、structural field、admin responseへ保存しない。
4. append APIは、開始APIが作成した既存sessionかつowner一致するsessionだけを受理する。
5. 未知のclient-supplied session IDから新規documentを作成しない。
6. entry IDはサーバーがcanonical session IDとsequenceから再構成する。clientの`entry.id`、`entry.sessionId`、`entry.logicalConversationId`は永続化キーの正本にしない。
7. remote repositoryは最初のwrite前にserver handleを取得し、local session IDからserver handleへのPromiseを共有する。既存runtimeのwrite queueにより、発行中のentryは順序を保って待機する。
8. storage layout versionを2へ更新し、version 1以前はread-only legacyとしてadmin取得を維持する。
9. 同一owner・同一idempotency keyのsession開始retryは同じhandleへ収束する。
10. HMAC secret ringに保持されているepochのsubject tokenをowner照合に利用し、epoch rotation後も既存sessionのownerを確認できるようにする。

## 必須回帰

- 任意文字列、電話番号形、別UUIDをappendへ直接送っても新規sessionを作れない。
- session開始APIが発行したIDだけでappendできる。
- 別userが他人のserver-issued sessionへappendすると拒否される。
- persisted path、structural field、admin responseにclient correlation keyのraw値が現れない。
- entry IDがserver側でsession IDとsequenceから決まり、client値で上書きできない。
- session開始retryが同じhandleへ収束する。
- remote repositoryがhandle取得を一度だけ行い、全appendをcanonical IDへ変換する。
- 旧storage layoutのread互換を維持し、新規appendは拒否する。
