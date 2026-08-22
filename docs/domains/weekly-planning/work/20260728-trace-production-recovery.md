# 週間計画 trace production recovery

Status: active / production verification pending
Updated: 2026-08-22
Tracking: Issue #89

## Current boundary

trace の source-side hardening と schema simplification は main へ統合済み。Issue #89 は source implementation の再設計ではなく、Worker / production 環境で same-conversation recovery 契約を確認しきるまで open を維持する。

## Remaining work

- frontend / Worker contract version と deployed revision を確認
- authenticated health → session start → append を production で確認
- `turn_diagnostic` の通常 input / renderer / semantic diagnostics を保存・取得できることを確認
- append failure / reload / retry 後も同じ logical conversation が別の空 session を増殖させないことを確認
- admin viewer で empty / malformed / activity / unexported を区別する
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

## Related ownership

- trace privacy / retention / TTL / restricted read / account deletion: Issue #45
- client-first storage / authority decisions: Issue #164

Issue #89 を Issue #45 の privacy rollout 全体と混ぜない。
