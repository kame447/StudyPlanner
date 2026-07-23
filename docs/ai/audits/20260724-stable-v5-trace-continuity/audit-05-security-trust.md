# 監査5: security / trust boundary

Status: fixed
最終更新: 2026-07-24

## 発見

trace再開情報を保存する場合、別userまたは別conversationのcursorやserver handleを再利用すると、監査ログの所有境界を破る。保存payloadへ会話本文を複製すると、既存trace retentionとredaction境界の外側に内容データが増える。

また、server-issued handleをclientへ保存しても、それを認証またはownershipの正本として扱うとtrust boundaryを逆転させる。handleは継続用structural metadataに限定し、append時のFirebase認証とserver-side owner検証を正本にする必要がある。

## 修正

- cursor keyとpayloadをuser ID、conversation IDへ二重拘束する。
- cursor内sessionの`userId`と`logicalConversationId`が要求scopeと一致しない場合は全体を削除する。
- session status、timestamp、counter、request ID、schema version、unknown fieldをruntime validationする。
- raw user text、assistant text、semantic document、Fact Graph、preview本文をcursorへ保存しない。
- cursor sizeを64 KiB、recent request IDを128件、保存cursorを24件へ制限する。
- server handle mappingをuser IDとlocal trace session IDへ拘束し、closed key validationとUUID形式検証を行う。
- stored handleはserver session IDとlogical conversation IDだけを持ち、raw UID、email、本文、owner tokenを追加保存しない。
- stored handleをowner証明として使用せず、remote append APIの認証とserver-side ownership検証を維持する。
- serverがsession不存在、ownership conflict、legacy read-only、conversation conflictを明示した場合だけmappingを破棄する。

## 結論

今回の修正は既存のserver authorityを迂回しない。client cursorとserver handle mappingは再読込後の継続metadataであり、server IDを任意に生成したりownerを決定したりしない。最終的な受理権限はWorker APIとserver repositoryに残る。
