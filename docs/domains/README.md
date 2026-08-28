# Domain documentation

A domain directory owns current documentation for one product/runtime responsibility.

- [`weekly-planning/`](weekly-planning/README.md): weekly planning conversation, semantics, scheduling, preview/approval, personalization and evaluation
- [`client-runtime/`](client-runtime/README.md): client-first execution and client/server authority boundaries
- [`reporting/`](reporting/README.md): learning-activity aggregation and the user-facing learning report
- [`product-observability/`](product-observability/README.md): service-wide telemetry, analytics read models and restricted diagnostic drill-down
- [`external-integrations/`](external-integrations/README.md): external provider/adapter boundaries, usage conditions and failure isolation for imported metadata and services

Create a new domain only when a genuinely independent responsibility exists. Do not create a domain for an agent, tool, test method, PR, branch, or temporary initiative.