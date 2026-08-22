# 週間計画 AI ロードマップ

Status: canonical / execution order
Updated: 2026-08-22

Current contract: [../weekly-planning-current-contract-v5.md](../weekly-planning-current-contract-v5.md)
Current status: [../weekly-planning-current-contract-status.md](../weekly-planning-current-contract-status.md)
Current priority: Issue #152 — Stable V5 adversarial conversation / prompt-injection security evaluation
Human grounding policy: [../tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md](../tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md)
Adaptive memory policy: [weekly-planning-adaptive-memory-learning-policy.md](weekly-planning-adaptive-memory-learning-policy.md)
Decision-ownership audit: [../audits/20260816-pr130-decision-duplication-adversarial-audit.md](../audits/20260816-pr130-decision-duplication-adversarial-audit.md)
Real-API policy: [../testing/weekly-planning-real-api-eval-policy.md](../testing/weekly-planning-real-api-eval-policy.md)

## 1. この roadmap の役割

この文書は architecture の詳細仕様を全文再掲する場所ではなく、現在どの順序で何を片付けるかを決める source of truth である。

AI / deterministic application の責務、Fact Graph、scheduler、preview、approval、save、persistence の契約は current contract を正とする。

## 2. 完了済み基盤

PR #109、#112、#113、#120、#127、#129、#130、#132、#140〜#151、#154、#155、#157 までで Stable V5 production 一本化、production 到達不能 legacy runtime / parser / interpreter の削除、semantic ownership、human grounding / correction / Fact lifecycle hardening、scheduler / preview / approval 境界、Browser Regression、file-by-file SOLID hardening、主要な conversation-quality 修正を main へ統合した。

PR #157 は 2026-08-20 に merge 済みであり、Issue #156 / PR #157 を現在作業として再開しない。旧 final merge-gate task は `tasks/closed/` へ移動した。

PR #162 では主要UIと専用AI計画surfaceが main へ統合された。これは Stable V5 の semantic ownership を変更するものではなく、週間計画UI責務分離の一部を前進させた。

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

## 4. 現在の最優先: Issue #152

PR #157 完了後の週間計画で、次の独立フェーズは Issue #152 の Stable V5 adversarial conversation / prompt-injection security evaluation である。

実装を先に増やすのではなく、direct / stored prompt injection、durable context poisoning、異常入力、Unicode / role confusion、数値 abuse などで現在の境界を攻撃し、実際に破れた箇所だけを owning layer で一般化して修正する。

固定日本語応答、raw Japanese semantic keyword/regex routing、特定ケース専用 patch で通さない。AI semantic ownership と deterministic application ownership の境界を security evaluation のために崩さない。

## 5. Issue #152 の実行順序

```text
current main / contract の再確認
→ threat / adversarial case inventory
→ current boundary への攻撃と evidence 収集
→ 実際に破れた owner layer の特定
→ targeted deterministic regression
→ 一般化した修正
→ relevant Real Luna / browser verification
→ current contract/status/roadmap/task/docs index の同期
→ final CI / Browser Regression
→ Issue #152 完了判定
```

緑のテストだけで安全性を宣言しない。visible transcript、typed state、Fact Graph、保存境界を必要に応じて確認する。

## 6. Issue #152 の次

Issue #152 完了後の feature / architecture expansion は、その結果と既存 open Issue の依存関係を再確認して決める。

少なくとも Issue #52 の週間計画UI責務分離は未完である。PR #162 で専用AI計画surfaceは成立したが、`WeeklyPlanningQuickEntryModal` から generic `QuickEntryModal` への週間計画 application/callback plumbing が残っているため、Issue #52 を完了扱いにしない。

privacy / personalization、cross-device approval uniqueness、saved-preview migration、trace運用などの既存独立scopeも、別Issueの owner を維持する。

## 7. Adaptive memory

暗記・想起系は英単語専用 heuristic に戻さない。current-week acceptance、durable preference、observed learning profile を分離し、proposal は了承前に scheduler へ適用しない。

大きな adaptive memory feature は security/adversarial evaluation と既存 owner 境界を崩してまで先行させない。

## 8. Prompt simplification

semantic prompt と dialogue prompt は総文字数だけを複雑性指標にしない。削減候補は schema と重複する format 指示、model-era repair scaffolding、application が一意に導出できる representation、同じ意味規則の prompt 間重複である。

Luna の能力向上だけを理由に application safety を AI へ移さない。一方、旧 model 時代に必要だった補助経路が real-API evidence 上不要なら one-element ablation で削る。

renderer output validation に残る output guardrail は raw-user semantic parser と同一視せず、real-API evidence を見て個別に判断する。

## 9. 検証原則

各構造変更は targeted deterministic regression を先に通し、その後 full TypeScript / test / build を通す。browser behavior に関係する変更では Browser Regression を通し、model behavior に関係する変更では real Luna を節目で再実行する。

exact wording を自動 quality oracle にしない。自動テストは deterministic invariant、real API は stochastic model/application contract と会話品質の human-reviewed observation として扱う。

PR #166 のQA自動化基盤はcross-cuttingな独立PRであり、このroadmapのfeature ownerではない。導入後は追加されたquality gateを適切な検証証拠として利用する。

## 10. 別 scope

Issue #52 の大規模 weekly UI 責務分離は独立 scope のまま維持する。

privacy / personalization broader rollout、cross-device approval uniqueness、saved-preview migration、trace privacy / lifecycle / production recovery、client-first execution architecture も各既存Issueとcanonical taskのownerを維持する。
