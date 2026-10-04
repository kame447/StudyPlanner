# Weekly Planning active work

Status: active-work index
Updated: 2026-10-04

This directory contains durable unfinished task/checkpoint records only when an Issue alone is insufficient for the technical acceptance detail.

Current durable records:

- `20260728-trace-production-recovery.md` — Issue #89
- `20260731-approval-operational-rollout.md` — Issue #51
- `20260731-personalization-rollout.md` — Issue #47
- `20260731-synced-conversation-session-store.md` — Issue #47 related cloud/session authority
- `20260731-trace-privacy-and-lifecycle.md` — Issue #45
- `20260926-issue333-japanese-semantic-evaluation.md` — Issue #333（#305 canary 前の日本語品質 gate、Luna 責務の棚卸し）
- `20260927-issue305-jev-first-focused-authorization.md` — Issue #305 置換単位1（focused authorization の Jev 第一経路のテスト環境での実動、Luna fallback、tuning だけでの校正、holdout、#335 回帰）
- `20260927-issue305-jev-first-focused-contextual.md` — Issue #305 置換単位2（focused contextual answer の quantity role と独立した意味の判定を Jev 第一経路へ移し、effort と provisional は Luna に残す。前方互換の decisionContext 規則を含む）
- `20260927-issue305-jev-first-temporal-scope-repair.md` — Issue #305 置換単位3（temporal scope repair の Jev 第一経路。既存の Luna repair の token 上限 60→320 の修正を含む）
- `20260927-issue305-jev-first-temporal-side-contribution.md` — Issue #305 置換単位5（temporal side contribution の Jev 第一経路は不採用とした。既存の Luna の token 上限 320→640 と `namedTimePeriod` schema の修正を含む）
- `20260927-issue305-jev-phase2-luna-inventory.md` — Issue #305 第二段階（単位1〜5の後の Luna 呼出し経路の再棚卸し。採用なし。C3 no-op 確認 gate は no-go。当時は C9 proposal reject を前提条件付きの次候補としたが、第三段階で no-go とした。同じ文書の末尾に、第三段階の再棚卸しを追記してある）
- `20260928-issue305-question-presentation-binding.md` — Issue #305 第三段階（提示済み質問と、それを提示した assistant message・revision を結ぶ binding 基盤。C9 / C5 の前提条件 (a)）
- `20260928-issue305-jev-first-proposal-reject.md` — Issue #305 C9（提示済み proposal への純粋な reject を Jev 第一経路にする案）。sealed holdout で事前登録 gate を満たさず no-go（直接受理 1/16、pure reject の p50 が悪化）。runtime は撤去済みで、型付きの evidence だけを残す
- 置換単位4（user context の保存先 owner の判定）の記録は user-context domain の [`../../user-context/work/20260927-issue305-jev-first-user-context-routing.md`](../../user-context/work/20260927-issue305-jev-first-user-context-routing.md) にある。単位1〜5 の結果の一覧は `20260926-issue333-japanese-semantic-evaluation.md` の「置換の結果」にある。

Issue-only active scopes such as #128 and [#335](https://github.com/kame447/StudyPlanner/issues/335) do not need duplicate task Markdown unless durable technical detail/checkpoints exceed what should live in the Issue.

Issue #52 was completed by PR #283 and is no longer an active scope. Its implementation history remains in the closed Issue/PR and repository history rather than in this active-work index.

Current execution ordering is owned by [`../roadmap/current.md`](../roadmap/current.md). Issue #136 / PR #275 is complete; its former semantic-regression branch is not a current implementation queue. Issue #152 is completed/closed; PR #174 is closed without merge and is historical evidence, not an active implementation or merge prerequisite. The merged replacement chain and retained security baseline are recorded in the roadmap and Issue #152. New release units must consume the applicable security contracts and current verification gates (including #335 where relevant), rather than restart #174. Re-fetch the owning checkpoint and exact target HEAD before reusing results; do not merge or remove retained evidence branches as ordinary cleanup.

Issue #305 retains the Jev integration design and rollout decision. Its initial default-off implementation was merged through PR #332; that completed branch must not be reused for the next evaluation. Issue #333 owns Japanese semantic evaluation, including the same-case Jev/Luna comparison, Gemini first-pass review, the limited Opus judge and tuning/holdout separation (human blind review is no longer required by owner decision on 2026-09-27). Jev-first replacement units keep their durable technical record in this directory (one record per unit); branch, PR and orchestration checkpoints stay in #305. Keep provider/privacy, security and shared telemetry with #187, #152 and #213. The runtime remains off by default, and neither merging PR #332 nor passing mock tests establishes Japanese quality or production activation.

Issue #246 is a special case where product/runtime requirements are canonicalized in [`../spec/learning-consultation-and-advice.md`](../spec/learning-consultation-and-advice.md). Phase 1A foundation was merged by PR #280; there is no active #246 branch at this checkpoint. Keep implementation status in Issue #246 rather than recreating the former branch or adding another duplicate work Markdown.

Cross-domain Issue #164 belongs to [`../../client-runtime/`](../../client-runtime/README.md).

When a record completes, move it to `docs/archive/work/closed/`. When replaced, move it to `docs/archive/work/superseded/`. Do not keep completed files here merely for history.
