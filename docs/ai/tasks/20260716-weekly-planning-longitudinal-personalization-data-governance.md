# 週間計画の長期個別最適化データガバナンスを完了する

Status: open / foundation merged, operational work remaining
Priority: P1
Requirement IDs: P7-PERSONALIZATION-001
Updated: 2026-07-19
Tracking: Issue #47
Foundation: PR #48 / `34c6744fefbc9b7f34bce36b97d47da4a86bf264`

## 1. 目的

PR #48で実装したaccount-linked personalization profile基盤を、本番で安全に運用できるデータ契約へ完成させる。

このtaskは、同意、保持、訂正、削除、権限、監査、sensitive dataの一般化、profile更新の整合性を担当する。plan／actual観測の作成、時間減衰集計、placement scoreは別taskへ委譲し、本taskへ再統合しない。

## 2. 完了済みのfoundation

PR #48で次を`main`へ実装した。

- version付きpersonalization profile schema
- profile factの`origin`、`confidence`、`scope`、`confirmedAt`、`expiresAt`
- 月曜始まり／日曜始まりの初回選択
- account単位の保存と復元
- 保存済み週始まりの「今週」「来週」解釈への反映
- 明示的な日付・曜日指定の優先
- 設定画面からの変更とprofile reset
- conversation traceとは別のrepository、collection、Firestore権限
- 一時的な相談条件を長期profileへ自動昇格しない境界

完了記録は`closed/20260718-weekly-planning-personalization-foundation.md`を正とする。

## 3. Product decision

### 3.1 利用条件

- 長期個別最適化データの収集・利用を週間計画機能の利用条件とする。
- 初回利用前に、収集対象、利用目的、保持期間、削除方法、必須性を利用規約とprivacy noticeで明示する。
- 同意しない利用者は、account-linked personalizationを前提とする週間計画を開始できない。
- 利用開始後の停止・削除要求は、週間計画機能またはaccountの終了と関連データ削除へ接続する。
- 法令上の適法性、未成年者、要配慮個人情報、国外利用、委託先は公開前に別途確認する。

### 3.2 データ区分

#### account存続中に保持する構造化profile

- 週の始まり設定
- 利用者が明示的に確定した長期設定
- 学習内容ごとの実績時間、見積り誤差、補正値
- 継続しやすいsession長、分割方法、復習間隔
- 提案の採用、修正、拒否、延期傾向
- 計画と実績の差分から得た集計値
- 各factの出典、信頼度、scope、確認日時、有効期限、schema version

#### 180日を上限とする原履歴

- user / assistant turn本文
- 週間計画state snapshot
- previewと修正前後の差分
- command、action、fallback、error、confidence
- planning observationとoutcome observation

#### 個人へ戻せない集計

- release別の成功率、修復率、fallback率
- 月別・学期別の利用傾向
- 個別sessionへ戻せない評価集計

### 3.3 利用目的

- 次回以降の週間計画の個別最適化
- 学習時間見積りとsession構成の補正
- 確認質問、acknowledgement、明示的修復、やり過ごし方針の個人化
- 計画失敗と実績差の原因分析
- サービス品質、不具合、model・rules改善

広告配信、信用評価、雇用・教育上の選別、第三者販売には利用しない。目的を拡張する場合は説明・同意の要否を再評価する。

## 4. 本taskの実装対象

### 4.1 同意と規約version

- 利用規約・privacy noticeのversion付きacceptance record
- 初回画面での目的、必須性、主要保持期間の短い説明
- 同意前のprofile・account-linked観測作成を拒否するgate
- 規約version更新時の再同意方針

### 4.2 保持・TTL・削除

- 原会話、state snapshot、preview差分、構造化interaction historyの180日TTL
- account deletion時のprofile、session、observation、trace、approval ledger、関連indexのcascade delete
- primary storageから30日以内、backupから最大90日以内の削除運用
- 削除済みデータを新しい評価fixtureへ投入しない境界

### 4.3 訂正・reset・無効化

- 明示的な長期設定の訂正を次回計画へ反映する
- profile resetの対象と非対象をUI上で説明する
- current-week conditionをrecurring profileへ自動昇格しない
- reset、invalidated、supersededされた観測をprofile集計から除外する
- 明示的設定を推定値で黙って上書きしない

相談sessionのresetと派生観測無効化は`20260716-weekly-planning-consultation-reset-and-invalidation.md`が担当する。

### 4.4 保存整合性

- profile更新をlast-write-winsの全体置換へ依存させない
- explicit settingとinferred aggregateの更新競合を分離する
- 再試行可能なoperation IDまたはtransactionで重複更新を防ぐ
- profileは派生元観測から再計算可能なcacheとして扱う
- source observation、aggregate version、updatedAt、effective sample informationを追跡可能にする
- week-start変更時に旧storage keyの会話・仮予定を不可視にしない移行または互換読み替えを完了する

### 4.5 権限・監査・sensitive data

- raw Firebase UIDを分析exportや評価fixtureへ直接含めない
- production database、管理画面、export、model evaluationの権限境界を分離する
- 保存時・通信時暗号化、最小権限、access audit、secret分離を適用する
- trace用の短期仮名tokenとaccount-linked profile identityを混同しない
- 病歴、通院、診療、障害等の自由記述を不要に長期保持せず、必要な生活制約へ一般化する
- 通常管理者が会話原文・要配慮情報を閲覧できないようにする

## 5. 後続taskとの責務境界

- `20260716-weekly-planning-synced-conversation-session-store.md`
  - 週sessionのクラウド正本、revision競合、offline cache、legacy migration
- `20260716-weekly-planning-consultation-reset-and-invalidation.md`
  - 相談resetとsource session由来データの無効化
- `20260716-weekly-planning-history-feature-extraction.md`
  - plan、approval、actualからversion付き観測を作成
- `20260716-weekly-planning-user-profile-time-decay.md`
  - 有効観測から時間減衰profileを再計算
- `20260716-weekly-planning-personalized-placement-scoring.md`
  - hard constraints通過後の候補順位を個人化

本taskでは、feature式、半減期、score weight、contextual banditを決定しない。

## 6. 受け入れ条件

- [ ] 同意前にaccount-linked profileまたは長期観測を作成しない
- [ ] acceptance recordが規約versionとtimestampを保持する
- [ ] 原文とstate snapshotが180日でTTL削除される
- [ ] profile factが出典、信頼度、scope、最終確認日、schema versionを持つ
- [ ] 一時的な週の条件をrecurring profileへ無断昇格しない
- [ ] 明示的なprofile訂正が次回計画へ反映される
- [ ] inferred updateがexplicit settingを上書きしない
- [ ] retryまたは同時更新でprofile factを重複・消失させない
- [ ] week-start変更後も既存会話・仮予定を復元できる
- [ ] account deletionで関連データをprimary storageから30日以内に削除する
- [ ] 通常管理者が会話原文・要配慮情報を閲覧できない
- [ ] product spec、dialogue architecture、trace architecture、Firestore運用文書、UI説明が同期する

## 7. Exit conditions

- [ ] Emulatorでprofile ownership、同意gate、権限、訂正、reset、更新競合を検証する
- [ ] TTLとaccount deletion cascadeをfixture付きで検証する
- [ ] week-start変更前後のstorage migrationまたは互換読み替えを中断・再実行fixtureで検証する
- [ ] privacy/legal reviewで利用目的、要配慮個人情報、未成年者、国外利用、委託先・第三者提供を確認する
- [ ] production deploy checklistへ規約version、acceptance timestamp、schema version、TTL policy、audit設定を追加する
- [ ] 本番設定と実ブラウザ確認が完了するまで`operationally deployed`と記録しない
