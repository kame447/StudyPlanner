---
name: pstack-show-work
description: Maintain a reviewable evidence-backed decision trail for long-running development work. Opt-in only.
disable-model-invocation: true
---

# pstack Show Your Work (vendored, adapted)

Source: https://github.com/backnotprop/pstack/blob/main/skills/show-me-your-work/SKILL.md

For long-running or unattended work, maintain one append-only TSV decision log in the task workspace. Use columns: ts, phase, decision, why, evidence, result. Keep each field single-line. Evidence must identify a real commit, PR, test output, trace, or artifact, not an unsupported assertion.

Record consequential decisions, verification outcomes, reversions, and handoffs, not every command. Reconcile the log against actual evidence before reporting completion. Keep it local by default; commit it only when the reviewer needs it. Existing canonical handoff and AGENTS.md requirements take precedence.

This skill does not spawn agents, choose models, merge PRs, or control Orrery.
