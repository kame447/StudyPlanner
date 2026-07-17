# weeklyPlanning roleplay coverage status

Status: canonical / active coverage status
Updated: 2026-07-17
Parent scenarios: [weekly-planning-roleplay-test-plan.md](weekly-planning-roleplay-test-plan.md)
Post-merge status: [weekly-planning-pr5-post-merge-status.md](../ai/weekly-planning-pr5-post-merge-status.md)

## 1. 役割

roleplay test planのscenario IDとstrict assertionを維持する。ただし、同文書内の単一`status`列、旧queue、`single interpreter / no merge`、`close/unmount = cancel`は2026-07-14時点のhistorical contractを含む。

現在coverageは本書で、module実装、production接続、自動検証、browser検証を分離して管理する。contract競合はcurrent contract statusとpost-merge statusを優先する。

## 2. Coverage matrix

| owner / slice | module implemented | production connected | automated verification | browser verification | notes |
| --- | --- | --- | --- | --- | --- |
| Gate P4 | yes | behavior-aware entrypoint connected | passed at recorded baseline | not complete | historical gate nameを新task名へ再利用しない |
| PR #5 conversation/session hardening | yes | `main`へmerge | 104 files / 1003 tests recorded on PR head | not complete | close-resume、storage、range、dialogue hardening |
| deterministic baseline + AI semantic補完 | yes | production intake pathへ接続記録あり | parser/validator/integration tests recorded | not complete | old no-merge assertionは非current |
| explicit repair / pass-over / grounded acknowledgement | yes | dialogue pathへ接続記録あり | tests recorded | not complete | real-model rubricも必要 |
| session-owned preview lifecycle | yes | App/session pathへ接続 | reducer/property/component tests recorded | not complete | modal close後のreopenをbrowser確認する |
| closed storage validation | yes | localStorage load/save pathへ接続 | v2/legacy/malformed round-trip tests recorded | not complete | merge後main再実行待ち |
| pending planning range | yes | intake pathへ接続 | PR #24・#26 focused/full tests passed | not complete | Issue #21完了。week-start profileとbrowser roleplayは未実装 |
| DA0r | yes | behavior pipelineに接続 | passed at recorded baseline | not complete | readinessとauthorization gate |
| DA0a | yes | assumption draft/canonicalization pipelineに接続 | tests recorded | not complete | proposal lifecycle全体はDA1bも参照 |
| DA0 | yes | non-exam preview bridge接続済み記録あり | tests recorded | not complete | pending/stale save guardはapprovalと分離 |
| DA1 | yes | behavior dialogue pipelineへ接続 | tests recorded | not complete | exact browser coverageはverification taskで確認 |
| DA1b | yes | not fully verified | module/integration tests recorded | not complete | correctionとproposal resolution |
| approval | yes | `App.tsx` approval path connected | tests recorded | retry scenario not complete | persistent multi-device idempotencyは別task |
| DA2 | yes | partial / PR #5 ownership path connected | module/property/component tests recorded | not complete | controller統一、IME、focus、reset/cancel |
| DA3a | yes | integration not fully verified | module tests recorded | not complete | relative constraint domain |
| DA3b | yes | integration not fully verified | module tests recorded | not complete | feasibility roleplay待ち |
| DA3c | yes | evaluation tooling exists | module/property tests recorded | not applicable to all items | requirement status sync継続 |
| conversation trace | yes | application instrumentation exists | tests recorded | production configuration not verified | privacy、TTL、account deletionは別task |
| longitudinal personalization | no | no | no | no | product decisionのみ。profile schema未実装 |

`tests recorded`はPRまたはcompletion recordでの実行結果を意味する。現在`main` HEADを対象とした再実行、browser verified、operationally deployedを意味しない。

## 3. Product decision status

次の項目はdecision pendingではない。

| scenario / contract | decision | implementation status |
| --- | --- | --- |
| `DA-INTERPRET-001` | deterministic baseline + AI semantic補完 | PR #5で実装。roleplay planのno-merge記述は更新対象 |
| `P6-RANGE-RESOLUTION-001` | 将来は初回week-start確認をprofile保存 | profile未実装。現在はPR #5 pending range契約 |
| `P7-TRACE-001` content保存 | redacted本文・snapshot・metadataを180日、初回acceptance gate | module基盤のみ。privacy controlsとproduction enablement未実装 |
| modal close lifecycle | closeは表示終了でありsession cancelではない | PR #5でsession-owned result復元を実装。browser未検証 |
| session reset / selected week change | 旧requestをinvalidateする | module/property契約あり。production/browser再確認が必要 |

曖昧入力を勝手に確定しない、accepted factを失わない、invalidated stale resultを適用しない、AIがsaveを起動しない等の安全境界は継続する。

## 4. Current verification queue

1. `docs/ai/tasks/20260714-weekly-planning-dialogue-stack-verification.md`
   - current `main`でmodule、entrypoint、自動検証、browser behaviorを再分類する。
2. `docs/ai/tasks/20260716-weekly-planning-entrypoint-request-ownership.md`
   - DA2のproduction ownershipとrace/keyboard契約をcontrollerへ統一する。

## 5. 必須browser scenario

### Close and resume

1. 週間計画を選択する。
2. user textを入力し送信する。
3. pipeline Promise待機中にmodalを閉じる。
4. Promise完了後にmodalを再表示する。
5. user発話、assistant応答、preview内容、draft昇格操作が復元される。

### Invalidation

1. active request中にselected weekを変更する、またはsession reset / explicit cancelを実行する。
2. 旧resultをstate、history、status、previewへ適用しない。
3. stale resultをfallback/error messageへ変換しない。

### Keyboard and focus

- IME composition中に送信しない。
- Enterは改行する。
- Ctrl/Meta+Enterは一回だけ送信する。
- 完了または失敗後にfocusを復元する。
- active request中の二重送信を拒否する。

## 6. 更新規則

- module追加だけでproduction connectedへ変更しない。
- unit test成功だけでbrowser verifiedへ変更しない。
- PR本文の検証結果を現在HEADへ自動継承しない。
- decision gate確定時はcurrent contract、post-merge status、scenario、spec、architecture、prompt、testを同期する。
- known bugをcoverage failureと混同せず、Issueとactive taskを明示する。
