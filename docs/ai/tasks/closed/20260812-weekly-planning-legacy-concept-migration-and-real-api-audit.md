# 週間計画 旧思想移植・ヒューリスティック監査・実API検証

Status: closed
Date: 2026-08-12
Closed: 2026-08-14
PR: #120

PR #120 (`weekly-planning-human-grounding-repair`) で実施したStable V5 hardeningの完了記録。

完了した主項目:
- human grounding / repair / self-repair
- request clockとselectedDateの分離、request-time not-before
- active-only Fact projection
- human-scale effort、per-unit effort、vocabulary session分割
- scheduler human-scale化とrelation ordering
- focused authorization/contextual semantic routes
- semantic prompt/orchestration監査
- 逐次・通しreal API observation
- legacy behavior-aware execution clusterのproduction runtime/type-only external edgeを0へ隔離
- full CI green後にPR #120をmainへmerge

PR #120後に独立して残す事項はIssueで管理する。少なくとも #115、#116、#118、#128 を参照。

この文書はcurrent execution taskではなくhistorical completion recordとして扱う。