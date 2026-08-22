# 週間計画 Stable V5 Semantic / Orchestration direction

Status: canonical / architecture direction
Updated: 2026-08-22

References:
- [main roadmap](weekly-planning-roadmap.md)
- [current status](../weekly-planning-current-contract-status.md)
- [current contract](../weekly-planning-current-contract-v5.md)
- [human grounding policy](weekly-planning-human-grounding-dialogue-policy.md)
- [adaptive memory policy](weekly-planning-adaptive-memory-learning-policy.md)
- [test philosophy](../testing/weekly-planning-test-philosophy.md)

## Semantic ownership

```text
raw user utterance + relevant conversation + typed machine state
→ AI semantic interpretation
→ structural / evidence / reference validation
→ deterministic binding / canonicalization
→ Fact Graph
→ one deterministic application decision owner
```

raw user utterance → regex / keyword / dictionary / deterministic legacy parser → semantic truth の補完・上書きは禁止。

## Orchestration direction

AI が複数解釈を持つ human meaning を typed representation へ落とす。意味が一意になった後の formal ID、calendar arithmetic、unit conversion、lifecycle、proposal state、question necessity、readiness、scheduler、preview、approval/save は application が所有する。

renderer / compatibility / trace は upstream typed decision を投影し、別 state から同じ意味を再計算しない。

## Prompt / repair

新しい failure を見つけても generic prompt へ規則を積むことを第一選択にしない。schema、typed state、deterministic conversion、owner boundary で表現できるかを先に確認する。semantic repair は必要な場合に最大1回。

## Memory

current planning memory、durable preference、observed learning evidence を分離する。one-week acceptance を durable へ自動昇格しない。

## Security

Current security/adversarial work の execution order は main roadmap / Issue #152 を正とする。stored untrusted strings が instruction へ昇格しないこと、AI だけで authorization / approval / save を突破できないことを boundary invariant として検証する。

この文書に PR #130 / #157 固有の branch、checkpoint、実行順序を保持しない。
