# 週間計画 trace production recovery

Status: active / production verification pending
Updated: 2026-10-04
Tracking: Issue #89

## Current boundary

trace の source-side hardening と schema simplification は main へ統合済み。Issue #89 は source implementation の再設計ではなく、Worker / production 環境で same-conversation recovery 契約を確認しきるまで open を維持する。

## Remaining work

- shared contractを参照する検証器でfrontend / Worker contract versionとrevision labelを確認。固定labelはdeployed commitの証明ではないため、実際のWorker deployment/version記録も照合する
- authenticated health → session start → append を production で確認
- `turn_diagnostic` の通常 input / renderer / semantic diagnostics を保存・取得できることを確認
- append failure / reload / retry 後も同じ logical conversation が別の空 session を増殖させないことを確認
- 現行 `/admin/logs` で索引上のactivity、索引0件、活動情報と索引件数の不整合、メタデータ不明/不正を区別する。索引0件をstorage全体が空という証拠にしない
- 一覧の取得ページ内でstatus filter除外と投影不能文書を区別し、本文pageの欠損/不正な番号・投影不能entry・byte制限・残り範囲を明示する
- 現行Debug Bundleはexport履歴を記録しないため、未展開/未取得を「未export」と判定しない。旧archive UIは復活させず、履歴未管理という制約を表示する
- production failure 時に stage / HTTP status / category / correlation ID を追跡できることを確認

## Verification

```text
same logical conversation
→ session count remains 1
→ successful turns produce non-zero diagnostic entries
→ reload / retry does not create another empty session
→ admin view does not present historical empty artifacts as normal active work
```

source test が green でも Worker deploy と production browser verification の代替にはしない。

## Verification boundaries

- 未認証healthの401とversion header一致は公開ラベルの観測だけであり、認証済みhealth成功ではない
- 合成データのtrace-only health → policy read → session/start → appendでは有料AIを呼ばない。ただし本番記録を作成するので、対象・合成データ・影響を明示した範囲で実施する。未同意のpolicyを自動acceptしない
- 同じキーでstart/appendを反復するtransport試験だけでは、実clientの永続outboxやreload後のキー再利用を証明できない。client runtimeを通す再試行と、通常turnがinput/semantic/renderer診断を生成する確認を分けて記録する
- 管理画面のread evidenceは既存のbounded query/batch結果から作る。追加のsession別full scanを導入せず、page内の欠損数をcollection全体の欠損数や重複のない累計として扱わない
- 匿名化は文字列の切り詰めより前に行う。メール検索を候補run単位にして長い不一致文字列の再探索を抑え、従来のmask範囲を維持する。source性能測定は本番障害の実証とは区別する

## Related ownership

- trace privacy / retention / TTL / restricted read / account deletion: Issue #45
- client-first storage / authority decisions: Issue #164

Issue #89 を Issue #45 の privacy rollout 全体と混ぜない。
