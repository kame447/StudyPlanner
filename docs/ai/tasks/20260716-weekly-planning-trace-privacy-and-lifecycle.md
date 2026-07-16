# 週間計画traceのprivacyとlifecycleを実装する

Status: planned / product decision recorded
Priority: P1
Requirement IDs: P7-TRACE-001

## 1. 背景

conversation trace基盤は実装済みだが、productionでの有効化、発話本文保存、利用者への説明、retention、account deletion、admin accessのproduct contractが未確定だった。

暗号化は漏えい時の安全性を高めるが、復号鍵を運営者が持つ場合は匿名化ではない。また、user IDを削除しても、発話本文、日時、学校・仕事・生活予定の組合せから個人を推測できる可能性がある。そのため、暗号化、仮名化、redaction、保存最小化を別々の対策として実装する。

## 2. Product decision

### 2.1 利用者への説明

- 毎conversationで同意を求めない。
- 初回利用時の利用規約・privacy noticeで、品質改善と不具合調査のために短期traceを保存することを明示する。
- 規約本文へ埋めるだけで終わらせず、収集対象、利用目的、保存期間、管理者閲覧、削除方法を短い要約でも表示する。
- 設定画面から品質改善用の本文収集を停止できるようにする。
- 法令上の適法性は公開前に別途確認し、本product decisionだけで法的判断を完了扱いにしない。

### 2.2 収集範囲

全session:

- event type
- command/action type
- accepted/rejected/fallback
- state revision
- latency
- error category
- model/provider version

本文を含むtrace:

- error、fallback、明示的修復、低confidence、保存失敗など調査価値が高いsession
- 上記以外は少量のrandom sample
- user/assistant本文を全sessionで恒常的に保存しない

### 2.3 個人との分離

- raw Firebase UID、メールアドレス、表示名をtrace documentへ保存しない。
- server-side HMACで`traceSubjectToken = HMAC(epochSecret, userId)`を生成する。
- tokenは30日単位でrotationし、異なる期間のtraceを恒久的に連結しない。
- epoch secretはtrace dataと別の権限境界で管理し、対象期間の削除要求に対応できる期間だけ保持する。
- 発話本文は保存前にメール、電話番号、URL query、明示名、識別子候補をredactする。
- Firestore標準暗号化またはCMEKは追加の安全管理措置として使うが、匿名化の代替とは扱わない。

この方式は完全匿名化ではなく、限定linkabilityを持つ仮名化として扱う。

### 2.4 Retention

| data | retention | reason |
| --- | ---: | --- |
| redacted user/assistant本文 | 30日 | 週間計画を約4周期確認でき、改善後の古い本文を残し続けない |
| state snapshot | 30日 | 本文と同じ調査単位で削除する |
| structured event metadata | 90日 | regression、release比較、失敗率の確認に使用する |
| subject tokenを除去した集計値 | 最大12か月 | 季節変動とrelease比較。個別sessionへ戻れない形だけ保持する |

必要性が確認できなければ短縮する。延長を既定にしない。

### 2.5 削除

- Firestore TTL policyをsession、entryの両collectionへ実際に設定する。`expireAt`保存だけで完了扱いにしない。
- account deletion時は、保持中epochの`traceSubjectToken`を再計算して関連session・entryをcascade deleteする。
- 設定画面から品質改善データの削除を要求できるようにする。
- export済みfixtureは自動生成せず、採用時に別IDへ変換し、元traceとの対応を破棄する。

### 2.6 閲覧権限

- 通常ユーザーと一般管理者は本文をreadできない。
- trace調査権限を持つ担当者だけが期間限定で閲覧できる。
- 本文閲覧、export、削除操作をaudit logへ記録する。
- client生成traceは監査証跡、課金、security判定の根拠に使用しない。

## 3. 実装対象

- metadata/contentのcollectionまたはfield-level分離
- server-side subject token発行
- epoch secret rotation
- sampling policy
- 保存前redaction
- content 30日、metadata 90日のTTL
- account deletion cascade
- privacy noticeと設定画面
- admin access audit
- export時の再redactionとunlink

## 4. 触らない範囲

- planning結果の計算
- scheduler
- dialogue action選択
- traceをuser profileや学習傾向memoryへ自動転用すること
- client eventを監査証跡として利用すること

## 5. 受け入れ条件

- raw user IDをtrace documentへ保存しない。
- 同じ利用者でもepochが異なればsubject tokenが一致しない。
- account deletion時に保持期間内のtokenを解決して削除できる。
- 本文を保存しないsessionでも品質指標を集計できる。
- 本文は30日、metadataは90日でTTL削除される。
- 本文収集停止後、新規本文traceを作成しない。
- 非権限者のreadを拒否し、権限者の閲覧をauditできる。
- exportからraw token、直接識別子、secretを除去する。
- product spec、dialogue architecture、trace architecture、Firestore運用文書、UI説明が同期する。

## 6. Exit conditions

- emulatorでownership、admin read、TTL対象field、account deletion処理を検証する。
- production feature flagとprivacy noticeをdeploy前checklistへ追加する。
- privacy/legal reviewの確認結果を別recordへ残す。
