# Stable V5 renderer prompt trace persistence investigation

## 結論

PR #105で返答生成rendererへ追加した最新発話、直近会話、計画情報、状態サマリーは、AI requestには含まれていたが、永続化されるrenderer diagnosticには含まれていなかった。

既存exportではturn diagnostic自体は保存されているため、確認できた主障害は全trace消失ではなく、新規renderer prompt情報の保存契約漏れである。

## 原因

- `dialogue_renderer_request` debug stageはStable V5 debug projectorの専用caseを持たず、unsupported stageとしてkey一覧だけへ縮退していた。
- renderer専用diagnosticが存在すると、重複回避のためrenderer debug stageは永続化前に除去される。
- 専用`dialogueRenderer.request`は旧fieldであるpurpose、requiredLabels、fallbackText、previewCountだけを保持していた。
- 結果としてPR #105で増えたprompt情報は、専用diagnosticにもdebug stageにも残らなかった。

## 修正方針

- rendererへ実際に送信したsystem/user messagesをactionId単位で自動回収する。
- 専用renderer traceの`request.promptContext`へ結合する。
- prompt構造にfieldが追加されても、実送信message全体から自動的にtraceへ反映する。
- 通常12 KiB、compact 2 KiB、minimal省略の段階圧縮を適用し、prompt肥大化でturn全体を保存不能にしない。
- outboxは`promptContext`をJSON-safeな値として検証し、失敗後の再送でも保持する。

## 恒久回帰テスト

今後renderer promptまたはtrace fieldを変更する際は、少なくとも次を通す。

1. 実rendererが送信したsystem/user messagesとtrace内messagesが一致する。
2. schemaに未登録の将来fieldを`promptContext`へ追加してもturn diagnosticへ残る。
3. 初回append失敗後、persistent outboxから再送してもfieldが残る。
4. 大容量fieldは段階圧縮され、client document target以下に収まる。
5. Worker preparation後もfieldが保持され、server document limit以下に収まる。
