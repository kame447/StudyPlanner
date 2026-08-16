# 週間計画 会話品質・Luna簡素化監査

Status: active / PR #130
Updated: 2026-08-16
Branch: `agent/weekly-conversation-quality-luna-audit`

Current contract: [../weekly-planning-current-contract-v5.md](../weekly-planning-current-contract-v5.md)
Current status: [../weekly-planning-current-contract-status.md](../weekly-planning-current-contract-status.md)
Current roadmap: [../strategy/weekly-planning-roadmap.md](../strategy/weekly-planning-roadmap.md)
Human grounding policy: [20260815-weekly-planning-human-grounding-dialogue-policy.md](20260815-weekly-planning-human-grounding-dialogue-policy.md)
Adaptive memory policy: [../strategy/weekly-planning-adaptive-memory-learning-policy.md](../strategy/weekly-planning-adaptive-memory-learning-policy.md)
Decision-ownership audit: [../audits/20260816-pr130-decision-duplication-adversarial-audit.md](../audits/20260816-pr130-decision-duplication-adversarial-audit.md)
Test philosophy: [../testing/weekly-planning-test-philosophy.md](../testing/weekly-planning-test-philosophy.md)

## 1. 目的

Stable V5 の実 API 会話を Luna で一 turn ずつ観測し、semantic ownership、deterministic application boundary、human grounding、scheduler、preview、approval/save 境界を維持したまま会話品質を上げる。

明確な失敗を見つけた場合は次 turn へ進まず、原因層を特定して一般化した修正を行う。特定の会話一件だけを通す fixed wording、raw-text regex、keyword patch、prompt 例文追加で症状を隠さない。

同時に、旧 model 時代に追加された prompt scaffolding、focused route、renderer heuristic、重複 representation を one-element ablation で減らす。ただし Luna の性能向上を理由に validation、binding、Fact Graph lifecycle、question necessity、proposal lifecycle、readiness、scheduler、preview、approval、save、persistence、safety を AI へ移さない。

## 2. 2026-08-16 architecture audit の結論

StudyPlanner 全体は「複雑だが構造化されている」と評価する。大きな layer boundary は維持されており、全面的なスパゲッティではない。

ただし conversation orchestration には、過去の段階的な修正を積み重ねた結果として、同じ意味の判断を複数箇所が再導出する局所的な構造負債がある。

最重要 hotspot は effort question である。`missing_effort_estimate` の必要性、measurement、memory proposal 由来の `session_duration`、compatibility projection、renderer context、contextual answer application が一つの typed question contract へ収束しきっていない。

次の hotspot は next conversational action である。baseline dialogue、repair override、memory-specific question、pending proposal short-circuit、missing-work fallback が段階的に最終 action を上書きできる。

さらに semantic pipeline と planning evaluation の両方で scheduler compilation が行われ、前者の scheduler status と後者の enriched authoritative compilation が同一 turn に存在する。

詳細な file-level 根拠は decision-ownership audit を正とし、この task へ重複転記しない。

## 3. 今後の refactor acceptance

今後はコード行数やファイル数だけで「きれいになった」と判定しない。各変更で、同じ意味の判断が何箇所に存在するかを確認する。

理想形は次である。

```text
raw user meaning
→ AI semantic interpretation
→ canonical typed state
→ one deterministic application decision owner
→ immutable typed decision
→ renderer / compatibility / trace は再推論せず投影
```

上流 decision を下流が別 state から再計算している場合は、動作していても refactor candidate とする。

## 4. Human grounding acceptance

application 内部の heuristic、一般知見、推定結果を、ユーザーとの共通基盤に既に入っている前提で話さない。

```text
internal candidate
→ proposal / explanation becomes observable
→ user accepts / rejects / modifies
→ accepted scope becomes shared ground
```

ユーザーを完全なフォーム入力者と仮定しない。短答、省略、後出し、訂正、指示語、以前の表現の再利用を通常ケースとして扱う。

正常系で question code や proposal code ごとの完成済み日本語を source of truth にしない。application は何を聞くかを決め、renderer は typed decision と current shared ground から自然に実現する。

## 5. Adaptive memory の current policy

英単語だけの固定 heuristic へ戻さず、暗記・想起中心の学習全般へ一般化する。15〜30分、1日複数回、spacing / retrieval は cold-start proposal の候補であり、自動採用する hard rule ではない。

current week / conversation acceptance、durable owner-scoped preference、observed learning profile を分離する。一回の「今回はそうして」を durable preference へ自動昇格させない。

新規学習と復習を分け、量・期限・availability から短時間 session だけでは不足する場合は mixed acquisition / review proposal を提示できる。ただし了承前に scheduler へ反映しない。

詳細は Adaptive Memory Learning Policy を正とする。

## 6. これまでの Luna evidence

Run `31859623464` では `fresh localIds` という内部管理向け prompt 文言を削除後、semantic call 1 回、repair 0 回で既存 mock-exam math component を継続し、daily 2h を構造化して preview へ到達した。内部 local-ID 運用を AI に長く説明する prompt は不要という evidence として維持する。

Run `31860330719`、`31860578812`、`31860642579` は vocabulary total-duration design が当時技術的に動いた historical evidence である。ただし product policy 自体を 2026-08-15 に変更したため、現在の暗記 UX acceptance evidence としては使用しない。

PR #130 では `weeklyPlanningStableV5DialogueRouting.ts` に存在した explanation-request regex と、通常 question を deterministic renderer、説明要求だけを AI renderer に振り分ける model-era 分岐を削除した。この方向は Luna simplification として妥当である。

## 7. Prompt / heuristic の現在評価

semantic prompt と dialogue prompt は現時点では一般原則へかなり整理されており、特定日本語の完成文を大量に積層した状態ではない。したがって「prompt が長いこと」自体を現在の主原因としない。

次の削減候補は schema と重複する format 指示、model-era focused repair scaffolding、application が一意に導出できる representation、同じ意味を複数 prompt が説明する部分である。

renderer validation に残る date / clock / execution-claim regex は raw user text の semantic parser とは別物であり、output guardrail として扱う。即時削除せず、Luna one-element ablation と real-API fallback 観測を根拠に判断する。

## 8. 次の implementation loop

最初に effort-question ownership を一本化する。question necessity、target、measurement、proposal-derived override を一つの typed decision にまとめ、response routing、compatibility projection、renderer context、contextual answer が再推論しない形を目標にする。

次に next-action ownership を整理する。repair、proposal、missing information、authorization、preview readiness の優先順位を一つの action policy に寄せ、router は action を選び直さず実行するだけにする。

その次に semantic pipeline の scheduler compilation と planning evaluation の authoritative compilation の二重性を確認する。前者が diagnostics-only ならその役割を明示し、不要なら除去候補とする。

続いて preview authorization compatibility を整理し、その後 focused semantic route / repair / renderer guardrail の Luna ablation へ進む。

この順序を飛ばして大きな adaptive memory feature を追加しない。現在の orchestration に新しい例外 branch を積み上げると、今回確認した構造負債を悪化させるためである。

## 9. Real-API protocol

```text
assistant turn を観測
→ semantic raw output
→ validation / optional repair
→ canonical binding / Fact Graph
→ proposal / dialogue decision
→ renderer output
→ scheduler / preview state
→ 人間視点で shared ground を確認
→ 次の user utterance をその時点で決める
```

明確な失敗があればその turn で停止する。internal heuristic が共有済み前提になっていないか、proposal が了承前に適用されていないか、acceptance scope を越えていないか、同じ質問を別表現で聞き直していないか、renderer の自然さと application state が矛盾していないかを確認する。

## 10. Documentation / scope

2026-08-16 の今回作業では production code、test code、workflow、configuration を変更せず、Markdown audit と documentation organization だけを行った。

`weekly-planning-docs-index.md` は PR #130 を current phase とするよう更新し、旧 V4 を正本としていた `codex-task-guide.md` は historical / superseded とした。

Issue #52 の大規模 weekly UI 責務分離と Issue #115 の raw-text regex entry routing は別 scope のまま維持する。PR #130 本文の `Closes #115` は current roadmap と矛盾するため、merge 前に PR metadata 側で修正する。

## 11. Completion gate

PR #130 を merge ready とする前に、high-risk decision ownership の扱いが明確になっていること、Luna ablation の結論が記録されていること、proposal / memory scope / scheduler / preview / approval の deterministic regression が green であること、full TypeScript / Vitest / build と Browser Regression が green であること、final dynamic real-API conversation が human review で preview まで到達すること、current contract / status / roadmap / task / docs index が最終 HEAD と一致していることを確認する。
