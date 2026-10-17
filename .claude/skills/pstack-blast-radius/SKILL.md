---
name: pstack-blast-radius
description: Investigate non-obvious regression risks outside a proposed diff and verify the critical safety assumption with executable evidence. Explicit invocation only.
disable-model-invocation: true
---

# Blast radius (adapted from pstack)

Source: https://github.com/backnotprop/pstack/blob/main/skills/blast-radius/SKILL.md

For changes with potentially hidden side effects, inspect the exact diff and follow callers, data contracts, persistence, event timing, library behavior, and downstream consumers beyond text search. Identify the one or two assumptions on which the change's safety depends. Distinguish observed facts from hypotheses; cite exact files and line numbers.

Prove critical assumptions with the smallest relevant executable test or runtime reproduction when practical. Describe unresolved risks with likelihood, impact, and a concrete check. Do not assert safety solely from a plausible explanation or a green unrelated test.

Follow repository AGENTS.md. Never invoke pstack's arena/swarm or create additional agents; Orrery owns orchestration and review assignment.
