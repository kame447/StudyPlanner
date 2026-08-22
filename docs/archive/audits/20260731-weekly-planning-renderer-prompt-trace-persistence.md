# Stable V5 renderer prompt trace persistence investigation

## 結論

PR #105で返答生成rendererへ追加した最新発話、直近会話、計画情報、状態サマリーは、AI requestには含まれる一方、merge後のコード上は永続化されるrenderer diagnosticへ渡す経路がなかった。

添付exportの`exportedAt`は2026-07-31T06:28:29.729Zで、PR #105のmerge（2026-07-31T07:28:16Z）より前である。したがって、このexportはPR #105後の欠落を直接証明するものではない。ただし、5件のturn diagnostic自体が保存され、renderer requestが旧4fieldだけで構成されていたことは確認できる。

post-mergeの欠落は、PR #105で増えたrenderer inputと、変更されなかった専用trace契約・debug projection・重複除去処理をコード上で照合して確定した。

確認できた主障害は、少なくとも新規renderer prompt情報の保存契約漏れである。現在のpost-merge Productionでturn diagnostic自体が完全に保存されていないかは、修正後の新しい実環境traceで別途確認する必要がある。

## 原因

- `dialogue_renderer_request` debug stageはStable V5 debug projectorの専用caseを持たず、unsupported stageとしてkey一覧だけへ縮退していた。
- renderer専用diagnosticが存在すると、重複回避のためrenderer debug stageは永続化前に除去される。
- 専用`dialogueRenderer.request`は旧fieldであるpurpose、requiredLabels、fallbackText、previewCountだけを保持していた。
- 結果としてPR #105で増えたprompt情報は、専用diagnosticにもdebug stageにも残る経路がなかった。

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
6. 修正後のProductionで新規turnを作成し、session・turn diagnostic・promptContextの実保存を確認する。
