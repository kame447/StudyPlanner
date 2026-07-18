# 週間計画の長期個別最適化データを実装する

Status: planned / product decision recorded
Priority: P1
Requirement IDs: P7-PERSONALIZATION-001
Updated: 2026-07-18

## 1. 背景

StudyPlannerは、単発の予定生成ではなく、利用者ごとの学習速度、継続しやすい時間帯、修正傾向、実績との差、週の始まり、確認方法の好みを継続的に学習し、次回以降の計画へ反映することを中核価値とする。この目的には、同一利用者へ長期間ひも付く構造化データが必要であり、匿名化された品質改善traceだけでは実現できない。

## 2. Product decision

### 2.1 サービス利用条件

- 長期個別最適化データの収集・利用をStudyPlannerの中核機能およびサービス利用条件とする。
- 初回利用前に、収集対象、利用目的、保持期間、削除方法、サービス終了との関係を利用規約とprivacy noticeで明示する。
- 個別最適化データの収集だけを停止してサービスを継続するopt-out modeは提供しない。
- 利用者が同方針を受け入れない場合は、アカウント作成または週間計画機能の利用を開始しない。
- 利用開始後に収集・利用の停止または関連データの削除を求めた場合は、個別最適化機能を停止し、原則としてアカウント終了または週間計画データの全削除手続へ移る。
- 法令上の適法性、未成年者の利用、要配慮個人情報を含む自由記述の取得方法は公開前に別途確認し、本product decisionだけで法的判断を完了扱いにしない。

### 2.2 データ区分

#### アカウント存続中に保持する構造化プロフィール

- 週の始まり設定
- 利用可能時間帯と生活上の固定制約
- 学習内容ごとの実績時間、見積り誤差、補正値
- 継続しやすいsession長、分割方法、復習間隔
- 提案の採用、修正、拒否、延期の履歴
- 明示的修復とやり過ごしの結果
- 計画と実績の差分
- ユーザーが明示的に確定した長期設定

#### 180日保持する原履歴

- user / assistant turn本文
- 週間計画のstate snapshot
- previewと修正前後の差分
- command、action、fallback、error、confidence
- 計画結果と実績報告の対応

#### 個人へ戻せない集計

- release別の成功率、修復率、fallback率
- 月別・学期別の利用傾向
- 個別sessionへ戻せない評価集計

### 2.3 保持期間

| data | retention |
| --- | ---: |
| user / assistant turn本文とstate snapshot | 180日 |
| preview、修正差分、構造化interaction history | 180日以上、プロフィール更新に必要な派生値はアカウント存続中 |
| 個別最適化プロフィール | アカウント存続中 |
| account deletion後の通常データ | 30日以内にprimary storageから削除 |
| backup上の削除済みデータ | 最大90日以内にrotationで消去 |
| 個人へ戻せない集計 | 利用目的が継続する期間。個人との対応を復元できないことを条件とする |

原履歴を180日経過後もそのまま延長しない。必要な情報は、出典、信頼度、最終確認日を持つ構造化プロフィールへ昇格し、原文はTTL削除する。

### 2.4 利用目的

- 次回以降の週間計画の個別最適化
- 学習時間見積りとsession構成の補正
- 確認質問、acknowledgement、明示的修復、やり過ごし方針の個人化
- 計画失敗と実績差の原因分析
- サービス品質、不具合、モデル・rules改善

広告配信、信用評価、雇用・教育上の選別、第三者への販売には利用しない。新しい目的へ拡張する場合は、既存の包括文言だけで処理せず、利用目的の変更範囲と必要な説明・同意を再確認する。

### 2.5 識別と安全管理

- 個別最適化プロフィールはaccount IDへひも付く保有個人データとして扱う。
- raw Firebase UIDを分析exportや評価fixtureへ直接含めない。
- production database、管理画面、export、model evaluationで権限境界を分離する。
- 保存時・通信時暗号化、最小権限、アクセスaudit、秘密情報の別管理を必須とする。
- trace用の短期仮名tokenと、個別最適化profileのaccount identityを混同しない。
- 自由記述に病歴、通院、診療、障害等が含まれ得るため、不要な医療詳細は抽出・長期保持せず、必要な生活制約へ一般化する。

### 2.6 利用者の権利とサービス終了

- 利用目的、保持データ区分、開示・訂正・削除手続を本人が確認できる状態にする。
- 誤ったプロフィールは利用者が訂正できるようにする。
- account deletionでは、プロフィール、原履歴、trace、approval ledger、関連indexをcascade deleteする。
- 削除済みデータを新しいモデル評価fixtureへ投入しない。
- 法令上保持が必要な記録がある場合は、サービスデータと分離し、目的外利用を禁止する。

## 3. 実装対象

- version付きpersonalization profile schema
- profile factのorigin、confidence、scope、confirmedAt、expiresAt
- conversation、plan、actual resultからの安全なprofile update
- raw history 180日TTL
- profile correction、reset、account deletion cascade
- privacy notice、利用規約、初回acceptance gate
- admin access controlとaudit log
- traceとpersonalization storageの責務分離
- sensitive free-textの一般化・redaction policy
- week-start profile変更時の週間計画storage key移行、または旧keyからの互換読み替え。`studyplanner.weeklyPlanning.<userId>.<weekStartDate>`に保存済みの会話・仮予定を設定変更だけで不可視にしない。

## 4. 受け入れ条件

- 同意前に長期個別最適化データを作成しない。
- 同意しない利用者は個別最適化を前提とする週間計画を開始できない。
- 原文は180日でTTL削除され、必要な派生値だけがprofileへ残る。
- profile factは出典、信頼度、scope、最終確認日を持つ。
- 一時的な週の条件をrecurring profileへ無断昇格しない。
- profile訂正が次回計画へ反映される。
- 週の始まり設定を変更しても、既存の週間計画会話・仮予定が旧storage keyへ取り残されない。移行または互換読み替えは中断・再実行に耐える。
- account deletionで関連データをprimary storageから30日以内に削除する。
- 通常管理者が会話原文・要配慮情報を閲覧できない。
- 利用規約だけでなく、初回画面上で利用目的と必須性を短く表示する。
- product spec、dialogue architecture、trace architecture、Firestore運用文書、UI説明を同期する。

## 5. Exit conditions

- emulatorでprofile ownership、権限、TTL、訂正、account deletionを検証する。
- week-start変更前後のstorage migrationまたは互換読み替えを、既存会話・仮予定を保持したfixtureで検証する。
- privacy/legal reviewで、利用目的の明示、要配慮個人情報、未成年者、国外利用、委託先・第三者提供を確認する。
- production deploy checklistへ規約version、acceptance timestamp、schema version、TTL policyを追加する。
