# 週間計画履歴のplanning/outcome observation化

Status: superseded / consolidated
Superseded: 2026-07-28
Replacement: `../20260728-weekly-planning-personalization-rollout.md`

このworkは未実装であり、完了扱いではない。

旧taskのdeterministic observation ID、source session/Plan参照、schema version、`active | invalidated | superseded`、actual duration/completion/delay等は有効な要件である。ただし、cloud session reset、retention、aggregate profileとの依存を分離したままrootへ置くと実行順が不明確になる。

replacement taskのPhase P1へ統合し、reset propagation、time decay、score、governanceまで一つの依存グラフで管理する。