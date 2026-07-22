# 外部予定取得をatomic success/failureへ修正する

Status: implemented / production not connected
Date: 2026-07-22
Branch: `test/weekly-planning-semantic-schema-eval`
PR: #77

## 背景

外部予定取得に`complete | partial | unavailable`を置き、`partial`時に最終previewをblockする設計としていた。

再確認の結果、StudyPlannerの上位契約として途中取得状態を公開する必要はない。paginationや複数requestの途中失敗は取得層内部の失敗であり、途中まで取得した予定をschedulerへ渡すべきではない。

また「予定作成全体を停止」という表現は不適切である。ユーザーが終了を指示していない限り、conversation、accepted facts、質問、計画作成sessionを維持する。

## 固定した方針

外部予定取得結果は次の二つだけとする。

```text
success(events)
failure(reason)
```

- `success(events=[])`は「登録予定なし」の正常成功である。
- `partial`状態は削除する。
- pagination等の途中結果は呼び出し側へ返さない。
- 一時的失敗は取得層が自動再試行する。
- 再試行後も失敗した場合だけfailureを返す。
- failureは予定0件として扱わない。
- failureでも入力済み計画内容は保持する。
- ユーザーが外部予定の利用を求めている間は、その予定を反映した最終previewだけを保留する。
- 他の条件確認とconversationは継続する。

## 自動再試行

自動再試行する。

```text
timeout
network error
rate limit
一時的server error
```

自動再試行しない。

```text
authentication error
permission error
source not configured
invalid response
```

既定は最大3回とし、待機時間は取得層へ注入可能にする。

## 変更

- `ExternalConstraintSourceSnapshot`を判別可能なsuccess/failure unionへ変更した。
- successだけが`events`を持つ。
- failureは途中取得済みeventを持たない。
- `constraint_source_partial`をresolver contractから削除した。
- atomic loaderを追加した。
- temporary failureの自動再試行を追加した。
- success空配列を正常な予定なしとして扱うようにした。
- 対話文から「予定作成をやり直す」「一部しか取得できない」を削除した。
- failure時に入力済み内容を保持していることを明示した。
- 認証、権限、未設定、invalid responseを原因別に案内するようにした。

## 注意点

- 現在のmoduleはproduction repository/calendar connectorへ未接続である。
- 各source adapterは、対象期間の全件取得が完了した場合だけsuccessを返す必要がある。
- 取得APIがpaginationを持つ場合、cursor完走をadapter内部で保証する。
- owner mismatchや不正eventは取得成功後のauthoritative validationでsource全体を拒否する。
- 外部予定取得失敗を理由にconversation stateを破棄してはならない。

## 検証項目

- 成功空配列を予定なしとして受理する。
- timeout後の再試行で成功する。
- authentication errorを再試行しない。
- retry上限後に一つのfailureを返す。
- failure結果がeventsを持たない。
- failureをschedulerの空予定として扱わない。
- failure時の対話が入力済み内容の保持を伝える。
- security rejectionでも計画作成の再開始を要求しない。

## 次の作業

- semantic全test、routing、full TypeScript、production buildを一括実行する。
- 各production source adapterの実際の取得契約を確認する。
- feature flag付きshadow接続時に自動再試行を統合する。
