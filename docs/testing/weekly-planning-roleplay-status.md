# weeklyPlanning roleplay coverage status

Status: canonical / active coverage status
Updated: 2026-07-16
Parent scenarios: [weekly-planning-roleplay-test-plan.md](weekly-planning-roleplay-test-plan.md)

## 1. 役割

roleplay test planのscenarioとstrict assertionは維持するが、同文書内の単一`status`列は2026-07-14時点の履歴として扱う。現在のcoverageは本書で、module実装、production接続、自動検証、browser検証を分離して管理する。

## 2. Coverage matrix

| owner | module implemented | production connected | automated verification | browser verification | notes |
| --- | --- | --- | --- | --- | --- |
| Gate P4 | yes | behavior-aware entrypoint connected | passed at recorded baseline | not complete | historical gate nameを新task名へ再利用しない |
| DA0r | yes | behavior pipelineに接続 | passed at recorded baseline | not complete | readinessとauthorization gate |
| DA0a | yes | assumption draft/canonicalization pipelineに接続 | tests recorded | not complete | proposal lifecycle全体はDA1bも参照 |
| DA0 | yes | non-exam preview bridge接続済み記録あり | tests recorded | not complete | pending/stale save guardはapprovalと分離 |
| DA1 | yes | behavior dialogue pipelineに接続済み記録あり | tests recorded | not complete | exact entrypoint coverageはverification taskで確認 |
| DA1b | yes | not fully verified | module/integration tests recorded | not complete | correctionとproposal resolution |
| approval | yes | `App.tsx` approval path connected | tests recorded | retry scenario not complete | persistent multi-device idempotencyは別task |
| DA2 | yes | actual assistant entrypoint connection not verified | module tests recorded | not complete | request ownership、IME、reset、unmount |
| DA3a | yes | integration not fully verified | module tests recorded | not complete | relative constraint domain |
| DA3b | yes | integration not fully verified | module tests recorded | not complete | feasibility roleplay待ち |
| DA3c | yes | evaluation tooling exists | module/property tests recorded | not applicable to all items | requirement status sync継続 |
| conversation trace | yes | application instrumentation exists | tests recorded | production configuration not verified | privacy、TTL、account deletionは別task |

`tests recorded`はcompletion recordでの実行結果を意味する。現在の`main` HEADを対象とした再実行が完了した意味ではない。

## 3. Decision-pending scenarios

次はproduct decision確定までpass/failを固定しない。

| scenario | pending decision |
| --- | --- |
| `P6-RANGE-RESOLUTION-001` | 「来週」を月曜〜日曜へ即時確定するか、scope保持後に開始日を確認するか |
| `DA-INTERPRET-001`のno-merge assertion | deterministic baseline + AI補完か、AI single semantic interpreterか |
| `P7-TRACE-001`のcontent保存 | production opt-in、metadata-only、本文保存、redaction、retention |

曖昧入力を勝手に確定しない、accepted factを失わない、stale resultを適用しない、AIがsaveを起動しない等の安全境界はdecision pendingではない。

## 4. Current verification queue

1. `docs/ai/tasks/20260714-weekly-planning-dialogue-stack-verification.md`
   - current `main`でmodule、entrypoint、自動検証、browser behaviorを再分類する。
2. `docs/ai/tasks/20260716-weekly-planning-entrypoint-request-ownership.md`
   - DA2のproduction接続とrace/keyboard契約を実装・検証する。

## 5. 更新規則

- module追加だけでproduction connectedへ変更しない。
- unit test成功だけでbrowser verifiedへ変更しない。
- PR本文の検証結果を現在HEADへ自動継承しない。
- decision gate確定時はscenario、spec、architecture、prompt、testを同じ変更で同期する。
