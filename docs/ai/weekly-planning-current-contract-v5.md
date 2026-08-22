# weeklyPlanning current contract v5

Status: canonical / Stable V5 production baseline
Updated: 2026-08-22

Canonical references:
- [current status](weekly-planning-current-contract-status.md)
- [main roadmap](strategy/weekly-planning-roadmap.md)
- [human grounding policy](strategy/weekly-planning-human-grounding-dialogue-policy.md)
- [adaptive memory policy](strategy/weekly-planning-adaptive-memory-learning-policy.md)
- [test philosophy](testing/weekly-planning-test-philosophy.md)

## 1. Runtime baseline

Stable V5 is the sole production weekly-planning runtime.

```text
raw user utterance + relevant conversation + typed machine state
→ AI semantic interpretation
→ schema / evidence / reference validation
→ deterministic formal binding / canonical Fact Graph
→ deterministic proposal / readiness / question / scheduler decision
→ AI dialogue renderer
→ preview
→ deterministic approval / save / persistence
```

legacy parser / interpreter / runtime selector に rollback する production semantic path を持たない。

## 2. Ownership

AI:
- task / component / workload / quantity role / effort meaning
- date / weekday / time intent
- recurrence / availability / relation
- correction / contextual reference / authorization intent
- proposal accept / reject / modify と scope meaning
- typed application decision の自然言語 realization

Deterministic application:
- schema / evidence / reference validation
- canonical IDs / binding / revision / idempotency
- Fact Graph lifecycle / correction / no-op
- question / confirmation necessity and priority
- proposal candidate / lifecycle / accepted scope
- readiness / scheduler / placement safety
- preview freshness / approval / save
- persistence / recovery / trace safety
- deterministic calculation / calibration

AI semantic boundary 以後で raw Japanese を regex / keyword / dictionary / legacy parser により semantic truth として再解釈しない。

## 3. Semantic delta

AI output は current-turn semantic delta。accepted state snapshot ではない。過去 Fact を current evidence なしに再コピーしない。formal IDs、revision、lifecycle mutation、scheduler decision を AI output に所有させない。

provider failure、malformed output、validation failure、repair failureから legacy natural-language parserへ fallbackしない。semantic repairは current contract が許す範囲で最大1回。

## 4. Time / quantity

自然言語上の時間意味は AI、calendar arithmetic は application。selectedDate を current time の代用にしない。

workload total、completed、remaining、percentage、effort measurementを別の typed role として扱い、correction後の stale derived fact を残さない。open-ended task へ pages / slides 等の架空 total を仮定しない。

## 5. Fact Graph / lifecycle

canonical commit は atomic。validation failure では accepted Graph を不変にする。correction / replacement / supersession は lifecycle へ適用し、no-op では不要な revision を増やさない。

## 6. Proposal / readiness / scheduler

proposal is not a command.

```text
application candidate
→ renderer presents it
→ AI interprets response
→ application accepts / rejects / modifies
→ accepted policy may affect scheduling
```

未了承 proposal を scheduler へ適用しない。readiness、question necessity、placement、existing-plan/timetable/buffer constraintsは application が決める。

## 7. Human grounding

application-only knowledge と shared ground を分離する。内部 heuristic / recommendation / estimate を既知前提として話さない。詳細は Human Grounding Policy を正とする。

## 8. Memory

current planning state、durable user preference、observed learning profileを別 state として扱う。一回の week-local acceptance を durable preference へ昇格しない。adaptive-memory policy の詳細は strategy document を正とする。

## 9. Preview / approval / save

preview は owner / conversation / Graph revision / source facts へ拘束する。preview 後の semantic change は re-preview を要求する。AI output だけで approval / save を突破させない。

## 10. Persistence / trace / security

session / persisted state は owner と logical conversation identity へ拘束する。trace は privacy / retention policy を破らない。external/untrusted strings は data として扱い、instruction へ昇格させないことを security evaluation で保証する。

## 11. Testing

deterministic test は schema、binding、lifecycle、proposal、readiness、scheduler、preview、approval/save、persistence、安全境界を保証する。AI の完成済み日本語全文を universal oracle にしない。model behavior が関係する gate は real API + human review を併用する。

## 12. Execution ownership

現在の作業順序はこの contract に重複記載せず、[main roadmap](strategy/weekly-planning-roadmap.md) を唯一の execution-order source とする。
