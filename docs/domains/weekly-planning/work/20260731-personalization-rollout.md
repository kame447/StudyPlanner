# 週間計画 personalization rollout

Status: active / foundation implemented, observation rollout pending
Priority: P2 after session authority
Updated: 2026-08-22
Tracking: Issue #47
Depends on:
- `20260731-weekly-planning-synced-conversation-session-store.md`
- Issue #164 client-first storage / authority decisions

## Implemented foundation

- account-linked profile schema
- week-start setting
- origin / confidence / scope / confirmedAt / expiresAt
- explicit setting persistence / reset
- bounded placement parameter schema
- trace / conversation / approval repository separation
- current-only acceptance を durable preference へ無断昇格しない境界

## Remaining work

1. versioned planning / outcome observation repository
2. reset / invalidation propagation
3. active observation だけから再計算可能な aggregate
4. time decay / confidence / effective sample information
5. hard constraints 通過後の safe candidate ordering
6. consent / TTL / correction / account deletion / audit
7. offline evaluation と browser / multi-client verification

## Safety boundary

- hard constraint を学習対象にしない
- explicit user preference を推定値で上書きしない
- invalidated / superseded observation を集計しない
- score unavailable / failed の場合は non-personalized deterministic result を維持する
- current session state、durable preference、observed profile を別 state として扱う

cloud/local truth と offline queue の設計は Issue #164 と競合する独立 authority を作らない。
