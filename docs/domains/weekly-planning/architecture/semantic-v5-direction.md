# Stable V5 semantic / orchestration direction

Status: canonical architecture direction
Updated: 2026-08-22

References:
- [Current contract](current-contract-v5.md)
- [Current roadmap](../roadmap/current.md)
- [Human grounding policy](../policies/human-grounding.md)
- [Adaptive memory policy](../policies/adaptive-memory.md)
- [Test philosophy](../quality/test-philosophy.md)

## Semantic ownership

```text
raw user utterance + relevant conversation + typed machine state
→ AI semantic interpretation
→ structural / evidence / reference validation
→ deterministic binding / canonicalization
→ Fact Graph
→ one deterministic application decision owner
```

raw user utterance → regex/keyword/dictionary/legacy parser → semantic truthの補完・上書きは禁止。

## Orchestration direction

AIが複数解釈を持つhuman meaningをtyped representationへ落とす。意味が一意になった後のformal ID、calendar arithmetic、unit conversion、lifecycle、proposal state、question necessity、readiness、scheduler、preview、approval/saveはapplicationが所有する。

renderer/compatibility/traceはupstream typed decisionを投影し、別stateから同じ意味を再計算しない。

## Prompt / repair

新しいfailureを見つけてもgeneric promptへ規則を積むことを第一選択にしない。schema、typed state、deterministic conversion、owner boundaryで表現できるかを先に確認する。semantic repairは必要な場合に最大1回。

## Memory

current planning memory、durable preference、observed learning evidenceを分離する。one-week acceptanceをdurableへ自動昇格しない。

## Security

Current security/adversarial execution order is owned by [the roadmap](../roadmap/current.md) and Issue #152. Stored untrusted strings must not become instructions, and AI alone must never bypass authorization/approval/save.