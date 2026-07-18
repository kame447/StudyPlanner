# 週間計画traceのprivacyとlifecycleを実装する

Status: implementing / automated verification pending
Priority: P1
Requirement IDs: P7-TRACE-001

## 1. 背景

conversation trace基盤は実装済みだが、productionでの有効化、発話本文保存、利用者への説明、retention、account deletion、admin accessの実装と運用が未完了である。

暗号化は漏えい時の安全性を高めるが、復号鍵を運営者が持つ場合は匿名化ではない。また、user IDを削除しても、発話本文、日時、学校・仕事・生活予定の組合せから個人を推測できる可能性がある。そのため、暗号化、仮名化、redaction、保存最小化を別々の対策として実装する。

長期個別最適化に必要なaccount-linked profileはtraceとは別のデータ区分とする。詳細は`20260716-weekly-planning-longitudinal-personalization-data-governance.md`を正とする。

## 2. Product decision

### 2.1 利用者への説明と利用条件

- 毎conversationで同意を求めない。
- 初回利用前の利用規約・privacy noticeで、個別最適化、品質改善、不具合調査のためにデータを保存することを明示する。
- 規約本文へ埋めるだけで終わらせず、収集対象、利用目的、保存期間、管理者閲覧、削除方法、収集を受け入れない場合は週間計画機能を利用できないことを短い要約でも表示する。
- traceおよび個別最適化データの必須収集だけを停止して、同じ週間計画サービスを継続するopt-out modeは提供しない。
- 利用者が利用停止・削除を求めた場合は、週間計画機能またはアカウントの終了と関連データ削除へ移る。
- 法令上の適法性、要配慮個人情報、未成年者、国外利用は公開前に別途確認し、本product decisionだけで法的判断を完了扱いにしない。

### 2.2 収集範囲

全session:

- event type
- command/action type
- accepted/rejected/fallback
- state revision
- latency
- error category
- model/provider version
- user / assistant turn本文
- state snapshot
- previewと修正前後の差分

品質改善traceは全sessionを対象とする。ただし、分析exportではraw account identifierを除外し、本文は保存前redactionを通す。

個別最適化用の構造化profileはtraceから直接参照せず、専用のprofile update boundaryを通して作成する。

### 2.3 個人との分離

- raw Firebase UID、メールアドレス、表示名をtrace documentへ保存しない。
- server-side HMACで`traceSubjectToken = HMAC(epochSecret, userId)`を生成する。
- trace tokenは30日単位でrotationし、quality traceだけから恒久的な利用者追跡を行わない。
- epoch secretはtrace dataと別の権限境界で管理し、削除要求へ対応できる期間だけ保持する。
- 発話本文は保存前にメール、電話番号、URL query、明示名、識別子候補をredactする。
- Firestore標準暗号化またはCMEKは追加の安全管理措置として使うが、匿名化の代替とは扱わない。
- account-linked personalization profileとtrace subject tokenを同じ識別子へ統合しない。

traceは完全匿名化ではなく、限定linkabilityを持つ仮名化データとして扱う。

### 2.4 Retention

| data | retention | reason |
| --- | ---: | --- |
| redacted user / assistant本文 | 180日 | 半年間の利用変化、複数release、学期・試験期を比較する |
| state snapshot、preview、修正差分 | 180日 | 本文と同じsession単位で原因分析する |
| structured event metadata | 180日 | regression、release比較、失敗率の確認に使用する |
| subject tokenを除去した集計値 | 最大24か月 | 季節変動とrelease比較。個別sessionへ戻れない形だけ保持する |

180日を超えて必要な情報は原文のまま延長せず、個別最適化profileの派生値または個人へ戻せない集計へ変換する。利用目的との関係で合理的な必要性がなくなったデータは、期限前でも削除できるようにする。

### 2.5 削除

- Firestore TTL policyをsession、entryの両collectionへ実際に設定する。`expireAt`保存だけで完了扱いにしない。
- account deletion時は、保持中epochの`traceSubjectToken`を再計算して関連session・entryをcascade deleteする。
- account deletionまたは週間計画機能終了時は、primary storage上の関連traceを30日以内に削除する。
- backup上の削除済みデータは最大90日以内のrotationで消去する。
- export済みfixtureは自動生成せず、採用時に別IDへ変換し、元traceとの対応を破棄する。
- 削除対象のtraceを新しいprofile update、evaluation fixture、学習データへ投入しない。

### 2.6 閲覧権限

- 通常ユーザーと一般管理者は本文をreadできない。
- trace調査権限を持つ担当者だけが期間限定で閲覧できる。
- 本文閲覧、export、削除操作をaudit logへ記録する。
- client生成traceは監査証跡、課金、security判定の根拠に使用しない。

## 3. 実装対象

- metadata/contentのcollectionまたはfield-level分離
- server-side subject token発行
- epoch secret rotation
- 保存前redaction
- content、snapshot、metadataの180日TTL
- account deletion cascade
- privacy notice、利用規約、初回acceptance gate
- admin access audit
- export時の再redactionとunlink
- personalization profile storageとの責務分離

## 4. 触らない範囲

- planning結果の計算
- scheduler
- dialogue action選択
- trace documentをそのままuser profileへ利用すること
- client eventを監査証跡として利用すること

## 5. 受け入れ条件

- 同意前にproduction traceを作成しない。
- 同意しない利用者は個別最適化を前提とする週間計画を開始できない。
- raw user IDをtrace documentへ保存しない。
- 同じ利用者でもepochが異なればtrace subject tokenが一致しない。
- account deletion時に保持期間内のtokenを解決して削除できる。
- 本文、snapshot、structured metadataは180日でTTL削除される。
- 非権限者のreadを拒否し、権限者の閲覧をauditできる。
- exportからraw token、直接識別子、secretを除去する。
- traceとaccount-linked personalization profileが別schema、別repository、別権限で管理される。
- product spec、dialogue architecture、trace architecture、Firestore運用文書、UI説明が同期する。

## 6. Exit conditions

- emulatorでownership、admin read、TTL対象field、account deletion処理を検証する。
- production feature flagとprivacy noticeをdeploy前checklistへ追加する。
- privacy/legal reviewの確認結果を別recordへ残す。

## 7. 実装状況

### 実装済み・自動検証待ち

- FirebaseアカウントIDを記録本文へ保存せず、サーバー側で30日単位の匿名化済み識別子を生成する処理
- メールアドレス、電話番号、URL内の識別情報、認証情報候補を保存前に除去する処理
- 会話本文、状態、処理情報へ180日後の削除日時を設定する処理
- 利用前の説明・同意状態を取得、承認するサーバー処理と画面側の接続部品
- 会話記録の追加、削除、限定された管理者閲覧、閲覧履歴の保存をサーバー側で行う処理
- 本番環境ではブラウザからFirestoreへ直接会話記録を書き込まない保存処理
- 個人情報保護境界と保存処理の単体テスト

### 自動検証後に確定する項目

- 既存の週間計画画面へ説明・同意表示が正しく接続されること
- 同意前に会話記録が保存されないこと
- Firestoreへのブラウザからの直接アクセスを拒否できること
- 全テスト、本番用ビルド、Cloudflare Workerの構成確認
- 一時的な検証用ファイルを最終差分から除去すること

### 環境・運用上の未達成項目

- 本番用の匿名化鍵とFirebase接続情報の登録
- Firestoreで180日後の自動削除設定を有効にすること
- 本番環境へのWorkerとFirestore Rulesの反映
- 法務・プライバシー確認
- 実ブラウザとFirestore Emulatorでの確認
