# 週間計画の個別最適化プロフィール基盤を実装する

Status: complete
Completed: 2026-07-18
Issue: #47
PR: #48
Merge commit: `34c6744fefbc9b7f34bce36b97d47da4a86bf264`

## 1. 完了範囲

PR #48で、長期個別最適化を後続実装できるaccount-linked profile基盤を`main`へ統合した。

- version付きpersonalization profile schema
- profile factの`origin`、`confidence`、`scope`、`confirmedAt`、`expiresAt`
- 月曜始まり／日曜始まりの初回選択
- account単位の保存と別端末でのprofile復元
- 保存済み週始まりの「今週」「来週」解釈への反映
- 明示的な日付・曜日指定の優先
- 設定画面からの週始まり変更
- profile reset
- conversation traceとは別のrepository、collection、Firestore権限
- 同意済み利用者だけがprofileを読み書きする保存境界
- 一時的な相談条件を長期profileへ自動昇格しない型・更新境界

## 2. 実装されたprofile contract

初期schemaは次を保持できる。

- `weekStartsOn`
- `subjectEstimateMultipliers`
- `preferredSessionMinutes`
- `updatedAt`

各factは値だけでなく、出典、確からしさ、適用範囲、確認日時、有効期限を保持する。将来の見積り補正やsession長推定を、自由記述や会話本文の直接参照ではなく、型付きfactとして追加できる。

## 3. 検証記録

PR #48のIssueコメントとPR履歴に、週始まり設定、設定画面、週間計画state、自然言語parser、Firestore権限を含む自動検証成功が記録されている。

この完了記録は、PR #48で実装されたfoundationの完了だけを示す。本番運用、法務確認、実ブラウザ確認、後続の学習pipeline完了を意味しない。

## 4. 未完了として分離した範囲

次はPR #48へ含めず、`docs/ai/tasks/`直下のactive taskで管理する。

- 週途中の現在時刻境界
- 週単位conversation sessionのクラウド同期
- 相談resetと派生観測の無効化
- plan／approval／actualからのversion付き観測作成
- 見積り誤差、session長、時間帯傾向の集計
- 時間減衰、観測数、不確実性、既定値への縮約
- 個人別placement score
- 規約version、初回同意、本番TTL、削除cascade、admin audit、privacy/legal review
- 本番Firestore設定と実ブラウザ確認

## 5. 後続task

- `../20260716-weekly-planning-midweek-current-time-start-boundary.md`
- `../20260716-weekly-planning-synced-conversation-session-store.md`
- `../20260716-weekly-planning-consultation-reset-and-invalidation.md`
- `../20260716-weekly-planning-history-feature-extraction.md`
- `../20260716-weekly-planning-user-profile-time-decay.md`
- `../20260716-weekly-planning-personalized-placement-scoring.md`
- `../20260716-weekly-planning-longitudinal-personalization-data-governance.md`
