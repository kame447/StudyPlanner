---
name: pstack-tdd
description: Apply pstack's focused regression-test-first workflow for bugs with cheap, clear local test targets. Opt-in only.
disable-model-invocation: true
---

# pstack TDD (vendored, adapted)

Source: https://github.com/backnotprop/pstack/blob/main/skills/tdd/SKILL.md

Use when explicitly requested or when a bug has a clear inexpensive local test target. Do not force costly or brittle tests.

1. Establish intended and observed behavior and the smallest reproduction.
2. Choose an existing, narrow executable test target.
3. Write a focused regression test and run it before changing production code. Confirm it fails for the expected reason.
4. Implement the smallest contract-preserving correction.
5. Rerun the focused test and relevant neighboring checks.
6. Report failing-before and passing-after evidence. If the failing test was impractical, state why and use the closest executable check instead.

Do not weaken assertions, add fragile mocks solely to satisfy this procedure, or change expected behavior to fit the current implementation.

Repository AGENTS.md remains authoritative. This skill never launches subagents or changes Orrery orchestration.
