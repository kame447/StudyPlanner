# StudyPlanner Documentation

Documentation placement is governed by [DOCUMENT_DICTIONARY.md](DOCUMENT_DICTIONARY.md).

## Read order

Repository work:

1. [`AGENTS.md`](../AGENTS.md)
2. [`PROJECT_MAP.md`](../PROJECT_MAP.md)
3. this index / documentation dictionary
4. owning domain README
5. canonical contract / current Issue / active work record

## Domains

- [Scheduling](domains/scheduling/README.md) — app-wide scheduled-event authority / `ScheduleOccurrence` projection / Plan・MonthEvent統合移行。Current owner: Issue #278
- [Weekly planning](domains/weekly-planning/README.md) — Issue #246 の「学習相談 → AI助言 → user adoption → 既存planning」planned requirement は [`learning-consultation-and-advice.md`](domains/weekly-planning/spec/learning-consultation-and-advice.md) が正本。runtime implementation は未完了
- [Client runtime](domains/client-runtime/README.md)
- [Reporting](domains/reporting/README.md)
- [Product observability](domains/product-observability/README.md)
- [External integrations](domains/external-integrations/README.md) — 書籍教材metadataの正仕様は [`material-metadata.md`](domains/external-integrations/spec/material-metadata.md)

## Cross-cutting work

- [Work documentation](work/README.md)

## History

- [Archive](archive/README.md)

`archive/` is evidence, not current instruction. Current decisions must live under their owning domain rather than under audience/tool folders such as `ai/`, `testing/`, `strategy/`, or `design/`.
