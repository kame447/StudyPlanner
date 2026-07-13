# weeklyPlanning 自然言語 capability model（historical reference）

Status: **historical capability inventory / not current DoR**
最終更新: 2026-07-13
Current DoR: docs/architecture/weekly-planning-dialogue-architecture-v4.md

A〜F の問題分類、既存 capability の可視化、command validation の原則を参照記録として保持する。GoalIntent/Post-R2 の提案や deterministic questionPlan を通常経路の正としない。

v4 では single AI interpreter が typed candidates を返し、normalize、validate、adapter、reducer、scheduler、preview、approval/save を deterministic core が担う。dialogue planner は snapshot と allowed action/topic/factRef の範囲だけを選ぶ。non-exam bridge、assumption/correction lifecycle、turn/request stale、untrusted strings、approval idempotency は DA0〜DA3c task に移管した。

この文書は実装状況と履歴の説明にのみ使い、status/queue/acceptance の判断は v4、roadmap、roleplay P7 table を参照する。
