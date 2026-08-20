# 週間計画 AI ロードマップ

Status: canonical / execution order
Updated: 2026-08-18

Current contract: [../weekly-planning-current-contract-v5.md](../weekly-planning-current-contract-v5.md)
Current status: [../weekly-planning-current-contract-status.md](../weekly-planning-current-contract-status.md)
Current PR task: [../tasks/20260818-pr157-final-real-luna-merge-gate.md](../tasks/20260818-pr157-final-real-luna-merge-gate.md)
Human grounding policy: [../tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md](../tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md)
Adaptive memory policy: [weekly-planning-adaptive-memory-learning-policy.md](weekly-planning-adaptive-memory-learning-policy.md)
Decision-ownership audit: [../audits/20260816-pr130-decision-duplication-adversarial-audit.md](../audits/20260816-pr130-decision-duplication-adversarial-audit.md)
Real-API policy: [../testing/weekly-planning-real-api-eval-policy.md](../testing/weekly-planning-real-api-eval-policy.md)

## 1. この roadmap の役割

この文書は architecture の詳細仕様を全文再掲する場所ではなく、現在どの順序で何を片付けるかを決める source of truth である。

AI / deterministic application の責務、Fact Graph、scheduler、preview、approval、save、persistence の契約は current contract を正とする。

## 2. 完了済み基盤

PR #109、#112、#113、#120、#127、#129、#130、#132、#140〜#151、#154、#155 までで Stable V5 production 一本化、production 到達不能 legacy runtime / parser / interpreter の削除、semantic ownership、human grounding / correction / Fact lifecycle hardening、scheduler / preview / approval 境界、Browser Regression、file-by-file SOLID hardening、主要な conversation-quality 修正を main へ統合した。

PR #130 の後に露出した不足は Issue #156 / PR #157 で敵対的に再監査している。

## 3. 現在の architecture 評価

StudyPlanner 全体は複雑だが構造化されている。大きな責務境界は維持されており、全面的なスパゲッティではない。

会話パイプラインでは、model の自然言語能力へ任せる部分と application が所有すべき意味決定を分離する。一つの意味判断に一つの application owner を割り当て、renderer、compatibility、trace は typed decision を再推論せず投影する構造を維持する。

```text
semantic meaning
→ canonical typed state
→ one application decision owner
→ immutable typed decision
→ renderer / compatibility / trace projection
```

## 4. 現在の最優先: PR #157

現在は PR #157 を完了させる。他の feature や Issue へ先に広げない。

PR #157 では current-turn grounding、質問意図、clarification、progress、quantity role、correction、completed-work state など、PR #130 後の real-Luna / adversarial audit で見つかった不足を typed contract として一般化して修正している。

通常 CI と Browser Regression は green である。残る merge gate は repeated real `gpt-5.6-luna` application-path evaluation、visible transcript と Fact Graph / application state の review、最終文書同期である。

Real Luna は `.github/weekly-planning-real-api-command.json` を更新して ChatGPT から繰り返し起動できる。通常 push ごとに heavy matrix を走らせず、checkpoint と merge-gate の節目で明示的に起動する。

Real Luna が meaningful defect を出した場合は merge を止め、その意味を所有する層で一般化して修正する。固定日本語応答、raw Japanese semantic keyword/regex routing、特定ケース専用 patch で通さない。

## 5. PR #157 完了順序

```text
repeated Real Luna merge gate
→ transcript / Fact Graph review
→ 必要なら一般化した修正 + deterministic regression
→ 同じ Real Luna gate を再実行
→ current contract/status/roadmap/task/docs index/PR本文を同期
→ final CI / Browser Regression確認
→ PR #157 merge
→ Issue #156 close
→ branch cleanup
```

## 6. PR #157 の次

PR #157 が完了した後は Issue #152 の Stable V5 adversarial conversation / prompt injection security evaluation を次の独立フェーズとする。

Issue #152 では実装を先に増やさず、まず direct / stored prompt injection、durable context poisoning、異常入力、Unicode / role confusion、数値 abuse などで現在の境界を攻撃し、実際に破れた箇所だけを修正する。

その後の feature expansion は、security/adversarial evaluation の結果と既存 Issue の依存関係を見て決める。

## 7. Adaptive memory

暗記・想起系は英単語専用 heuristic に戻さない。current-week acceptance、durable preference、observed learning profile を分離し、proposal は了承前に scheduler へ適用しない。

大きな adaptive memory feature は PR #157 と Issue #152 の整合を崩してまで先行させない。

## 8. Prompt simplification

semantic prompt と dialogue prompt は総文字数だけを複雑性指標にしない。削減候補は schema と重複する format 指示、model-era repair scaffolding、application が一意に導出できる representation、同じ意味規則の prompt 間重複である。

Luna の能力向上だけを理由に application safety を AI へ移さない。一方、旧 model 時代に必要だった補助経路が real-API evidence 上不要なら one-element ablation で削る。

renderer output validation に残る output guardrail は raw-user semantic parser と同一視せず、real-API evidence を見て個別に判断する。

## 9. 検証原則

各構造変更は targeted deterministic regression を先に通し、その後 full TypeScript / test / build を通す。browser behavior に関係する変更では Browser Regression を通し、model behavior に関係する変更では real Luna を節目で再実行する。

exact wording を自動 quality oracle にしない。自動テストは deterministic invariant、real API は stochastic model/application contract と会話品質の human-reviewed observation として扱う。

## 10. 別 scope

Issue #52 の大規模 weekly UI 責務分離と Issue #115 の raw-text regex weekly entry routing は独立 scope のまま維持する。

privacy / personalization broader rollout、cross-device approval uniqueness、saved-preview migration も既存の独立 scope を維持する。
