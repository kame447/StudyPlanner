# weeklyPlanning current contract status

Status: canonical / Stable V5 sole runtime + PR #157 final adversarial validation
Updated: 2026-08-18

Canonical contract: [weekly-planning-current-contract-v5.md](weekly-planning-current-contract-v5.md)
Current roadmap: [strategy/weekly-planning-roadmap.md](strategy/weekly-planning-roadmap.md)
Current PR task: [tasks/20260818-pr157-final-real-luna-merge-gate.md](tasks/20260818-pr157-final-real-luna-merge-gate.md)
Human grounding policy: [tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md](tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md)
Adaptive memory policy: [strategy/weekly-planning-adaptive-memory-learning-policy.md](strategy/weekly-planning-adaptive-memory-learning-policy.md)
Decision-ownership audit: [audits/20260816-pr130-decision-duplication-adversarial-audit.md](audits/20260816-pr130-decision-duplication-adversarial-audit.md)
Real-API policy: [testing/weekly-planning-real-api-eval-policy.md](testing/weekly-planning-real-api-eval-policy.md)

## 1. 現在位置

Stable V5 が唯一の production 週間計画 runtime である。PR #109、#112、#113、#120、#127、#129、#130、#132、#140〜#151、#154、#155 までの主要な基盤・修正は main へ統合済みである。

現在の唯一の active conversation-quality PR は #157 `agent/issue156-prompt-simplification-adversarial-audit` である。Issue #156 の敵対的監査で、PR #130 後に露出した grounding、質問意図、進捗、訂正、量の役割、完了状態などの typed contract の不足を一般化して修正している。

通常 CI と Browser Regression は green であり、現在は最終の repeated real `gpt-5.6-luna` merge gate と transcript / Fact Graph review が残る。以前の API quota blocker は解消し、provider smoke は成功している。

## 2. 現在の architecture 判定

AI と deterministic application の責務境界そのものは崩していない。raw user text / conversation context の意味理解は AI、schema / evidence / binding / Fact Graph lifecycle / question necessity / proposal lifecycle / readiness / scheduler / preview / approval / save / persistence / recovery / derived calculation は application が所有する。

PR #157 では renderer に必要な application-owned 意味を typed contract として渡し、renderer が question code や断片的 state から意味を再推論する範囲を狭めた。会話品質のために fixed Japanese normal-path response や raw Japanese semantic keyword/regex routing を戻さない。

## 3. PR #157 で維持する主要契約

current-turn で受理された事実は observable grounding に必要な情報として renderer へ渡す。別の質問が pending でも、追加された予定・制約・作業内容を無視したような会話にしない。

質問の必要性と意味軸は application が決め、renderer は typed intent を自然言語化する。clarification、relation repair、missing work、effort、progress などを opaque code だけから推測させない。

open-ended な作業にはページ数・スライド数などの総数を勝手に仮定しない。固定総量が明示されている場合は exact quantity を使い、そうでなければ割合などユーザーが答えられる進捗表現を使う。

完了状態、訂正、割合から exact quantity への移行では古い派生量を残して二重計上しない。100% 完了後に同じ作業の進捗を再質問せず、後から未完了へ訂正された場合は残作業を再生成できる状態を維持する。

## 4. Human grounding / memory

application 内部の heuristic、推奨、推定結果を shared premise として話さない。proposal は会話上へ提示し、user accept / reject / modify を経た accepted scope だけを shared ground とする。

current week / conversation acceptance、durable user preference、observed learning profile は別 state として扱う。一回の「今回はそうして」を durable preference へ昇格させない。

暗記・想起系の詳細 policy は Adaptive Memory Learning Policy を正とする。

## 5. Real Luna evaluation

Real Luna は optional demo ではなく、semantic interpretation と dialogue realization の correctness gate として扱う。一回の成功を合格根拠にせず、checkpoint と merge-gate を用途で分ける。

ChatGPT が GitHub 作業を継続する場合は `.github/weekly-planning-real-api-command.json` を更新して real-API workflow を起動できる。通常 source push では heavy real-API matrix を自動実行しない。

merge gate では visible transcript と Fact Graph / application state の両方を確認する。形式上 green でも会話が不自然、または machine state と矛盾する場合は失敗として扱う。

## 6. 現在までに維持する主要能力

selectedDate と実発話日時の分離、request-time not-before boundary、relative planning range grounding、active-only corrected Fact projection、proposal acceptance / rejection grounding、repair agenda、human-scale effort question、per-unit effort、session chunking、task relation ordering、existing-plan buffer、owner-scoped observed effort calibration、canonical date / weekday / clock validation、focused machine-pending semantic route、preview / approval runtime isolation は current baseline として維持する。

## 7. 現在の execution order

```text
PR #157 final repeated Real Luna merge gate
→ transcript / Fact Graph human review
→ final docs / PR metadata sync
→ final deterministic CI / Browser Regression confirmation
→ PR #157 merge
→ Issue #156 close
→ merged branch cleanup
→ next independent issue
```

Real Luna が defect を出した場合は merge へ進まず、その意味を所有する層で一般化して修正し、可能なら deterministic regression を追加した後に同じ gate を再実行する。

## 8. 別 scope

Issue #52 の大規模 weekly UI 責務分離と Issue #115 の raw-text regex weekly entry routing は独立 scope のまま維持する。

privacy / personalization broader rollout、cross-device approval uniqueness、saved-preview migration 等も既存の独立 scope を維持する。PR #157 をこれらの feature expansion に広げない。
