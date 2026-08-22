# 週間計画の期間短答・日曜日終了境界 修正完了記録

Status: closed / completed
Completed: 2026-07-17
Issue: #23
Pull request: #24
Main merge commit: `bb39e968d7b4923a159a11380fe914d8ed2eb5e7`

## 1. 対象

週間計画の計画期間質問に対する短答と、`日曜日まで`の終了境界解釈を修正した。

対象となった主な利用例は次である。

- `今週`、`今週です`、`今週でお願いします`
- `来週`、`来週です`、`来週でお願いします`
- `週末`、`週末です`
- `日曜日までの予定を立てて`
- `今すぐ`、`1時間後`、`30分後`
- `今日20時`、`明日`、`明日の朝`
- 月日、曜日、時刻を含む開始地点

## 2. 実装結果

- active `planning_period` questionに対するnamed range短答をdeterministic parserで受理する。
- `日曜日まで`は開始日時を推測して即時確定せず、終了境界だけをpending planning rangeへ保持する。
- 開始日時が後続turnで得られた時点でcanonical `set_planning_range`へ昇格する。
- 終了日時より後の開始候補は採用せず、既存の終了境界を維持する。
- `planningStartDateTime`と`planningEndDateTime`をcommand、state summary、storage境界へ反映した。
- 片側だけを持つdate windowをclosed validatorで検証可能にした。
- AI candidate経路でもpending終了境界との不一致を拒否する。
- 引用、例文、第三者発話、教材・説明文脈の誤採用を防ぐnegative guardを維持した。

## 3. GitHub再確認で追加修正した事項

最初の実装後のGitHubレビューで次を修正した。

- 終了境界だけを持つpending rangeが共通validationとstorageで拒否される契約不整合
- runtime validation内の`planningStartDate`二重宣言によるTypeScript build failure
- 土曜日開始から日曜日までを3日とする誤ったテスト期待値
- 終了境界だけのpending commandに対するruntime boundary test不足

## 4. 検証結果

GitHub Actions run `29577182656`でPR merge refを対象に次を実行し、すべて成功した。

- `npm ci`
- `git diff --check origin/main...HEAD`
- focused regression
- `src/features/weeklyPlanning` suite
- 全テスト `npm run test:run`
- production build `npm run build`

一時検証workflowは検証後にPR差分から削除した。最新branch headとsquash merge前headではCloudflare Pages deployも成功した。

## 5. 完了判定

Issue #23の再質問ループ、named range短答、日曜日終了境界、任意開始日時の対象契約は完了とする。

次は本taskの対象外であり、別Issue・taskとして扱う。

- Issue #21: 漢数字を含む絶対日付のtokenizationと曜日誤認
- account-linked week-start profile
- browser実利用で新たに発見される未登録の自然言語表現
