# Weekly Planning

Status: canonical domain index
Updated: 2026-08-22

Stable V5 is the sole production weekly-planning runtime. This directory is the only current documentation root for weekly-planning responsibility.

## Read order

1. [Current contract](architecture/current-contract-v5.md)
2. [Semantic ownership](architecture/weekly-planning-semantic-ownership-boundary-v5.md)
3. [Dialogue architecture](architecture/weekly-planning-dialogue-architecture-v5.md)
4. [Human grounding policy](policies/human-grounding.md)
5. [Test philosophy](quality/test-philosophy.md)
6. [Current roadmap](roadmap/current.md)
7. [Active work](work/README.md)

## Responsibility map

- `spec/`: product intent and user-facing requirements
- `architecture/`: runtime/data/ownership invariants
- `policies/`: conversation and learning policies
- `personalization/`: personalization-specific design
- `quality/`: deterministic, browser and real-model evaluation policy
- `roadmap/`: execution order and architecture direction
- `work/`: durable unfinished tasks/checkpoints for this domain

## Current state

- Stable V5 owns weekly-planning production semantics.
- AI interprets natural language and realizes typed dialogue; deterministic application code owns validation, lifecycle, question/proposal decisions, scheduling, preview, approval and save.
- PR #162 established the dedicated `AiPlanningView`; Issue #52 still owns removal of remaining weekly-planning plumbing from generic QuickEntry.
- Issue #152 owns adversarial/prompt-injection evaluation.
- Trace privacy/recovery, personalization/cloud authority, multi-device approval uniqueness, saved-preview migration and AI-cost observability remain independent Issues.
- Client-first execution is a separate responsibility under [`../client-runtime/`](../client-runtime/README.md).

A historical file, old `Status: active`, branch name or PR number never overrides this domain index or the current contract.