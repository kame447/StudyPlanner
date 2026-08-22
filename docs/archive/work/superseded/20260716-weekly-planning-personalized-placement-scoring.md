# 個人別placement scoring

Status: superseded / consolidated
Superseded: 2026-07-28
Replacement: `../20260728-weekly-planning-personalization-rollout.md`

このworkは未実装であり、完了扱いではない。

safe candidate生成後の順位だけを個人化し、profile不足または計算失敗時に既存heuristicへ戻す契約は維持する。ただしobservation repository、validity propagation、aggregate profileが存在しない現在、score taskだけを独立実行できない。

replacement taskのPhase P4へ統合し、hard constraint非変更、uncertainty penalty、structured reason、offline walk-forward評価を同じ完了gateで管理する。