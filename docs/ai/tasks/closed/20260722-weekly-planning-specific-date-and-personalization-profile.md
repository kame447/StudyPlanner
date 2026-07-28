# 特定日計画とpersonalization profile foundation

Status: closed / foundation implemented and automated verified
Closed: 2026-07-28
Implemented by: PR #77

## 完了内容

- task-level `allowed_date | excluded_date`
- non-consecutive exact dateの和集合
- weekly weekday setとweekday range展開
- exact excluded dateの差集合
- explicit allow/exclude conflict
- date-only hard unavailable
- recurring fixed reservationへの例外日適用
- generic scheduler inputのtask date eligibility
- source fact refsの保持
- personalization profile v2 schema
- v1→v2 migration
- bounded placement parameter、feature/weight version、provenance
- semantic tests、routing test、TypeScript、production build成功記録

Stable V5 feature-flagged runtime接続後、task date eligibilityはpreview schedulerで消費される。旧本文の「production executor未接続」「scheduler未消費」は現行状態ではない。

## 残件の移管

- actual AI date eval、browser roleplay、migration/cutover:
  - `../20260728-weekly-planning-stable-v5-verification-and-cutover.md`
- observation、time decay、score、governance:
  - `../20260728-weekly-planning-personalization-rollout.md`

foundation taskへ後続のlearning pipelineとcutoverを混在させない。