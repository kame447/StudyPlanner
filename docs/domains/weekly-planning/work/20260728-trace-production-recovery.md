# 週間計画 trace production recovery

Status: active / source recovery fixes and production verification pending
Updated: 2026-10-04
Tracking: Issue #89

## Current boundary

trace の source-side hardening と schema simplification は main へ統合済みだが、2026-10-04 の再監査で source の再試行境界にも未解決の不具合を確認した。Issue #89 は以下の source 修正と Worker / production 環境での same-conversation recovery 検証を完了するまで open を維持する。

## Confirmed recovery gaps

- **同時 start の競合検証:** 同じ利用者・idempotency key で異なる conversation key を同時に送ると、immutable write の敗者が保存された conversation と異なる handle を成功として返し得た。通常の既存文書読み込みと競合後の再読み込みを同じ検証に統合し、owner / logical conversation / serverIssued / storage layout の一致を要求する。正当な同一要求の並行再試行は同じ handle に収束させる
- **epoch 境界の応答消失:** epoch 690 の start 保存後に応答が失われ、同一入力を epoch 691 で再試行すると、現行の epoch 依存 canonical ID により空 session が2つになることをオフラインの実 Worker handler で再現した。これは未修正。同一 epoch の再試行と、取得済み handle を使った境界後 append は対照条件として成功する。単純な検索後作成では並行実行の競合が残るため、原子的な収束方法を検証してから実装する
- **本番の読み込み停止:** 2026-10-03 19:46:57 UTC の通常の認証済み Admin Logs 読み込みで、Worker が `missing HMAC epoch` を記録した。secret binding は存在するが必要 epoch の値の有効性は未確認。既存の保持対象鍵を失わない復旧を #45 と連携して進める。ログイン用パスワードとは別の設定であり、既存 ring を新しい鍵だけで上書きしない

このオフライン再現が元の本番の重複を説明するかは未確認。上記の同時 start 検証修正だけで、epoch 境界の重複や本番の鍵不足が解消したと扱わない。Worker deployment の Git revision 対応も未確認であり、Pages/main の更新は Worker deploy の証拠ではない。

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
