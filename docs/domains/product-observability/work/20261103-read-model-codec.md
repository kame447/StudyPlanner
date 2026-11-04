# Stored read-model decoding boundary

Status: implementation and local integration verified; native CI pending
Publication base: `cc1cbce6bc5bd307478de9fdd0180d18ef68edf8`
Original audit base: `7643adc58354f36d03dc1801469db327a27e491c`
Branch: `refactor/observability-read-model-codec`
Domain: #213, Product Observability

## Responsibility

The query service owns Firestore reads, ordered cursors, registration counts, and
assembly of the bounded overview. The internal read-model codec owns conversion
of stored checkpoint, daily rollup, user summary, and active-window documents.
The service's public API and query order remain unchanged.

The codec moves the existing decoding and rejection rules without tightening
validation or changing defaults, error messages, time lookup, or dirty-window
suppression. Its actor-subject predicate shares the existing regular expression
between stored user decoding and the service's input/cursor checks.

## Alternatives

- Leave decoding in the service: lowest immediate change, but storage schema
  interpretation and query orchestration remain coupled.
- Extract NDL parsing: useful provider boundary, but overlaps active PR #955.
- Extract the read-model codec: a separate change reason with existing tests and
  no active PR overlap at the checked base. This is the selected scope.

No new generic repository, interface hierarchy, dependency, or validation layer
is introduced. Auth, AI interpretation, persistence writes, and metric semantics
are outside scope.

## Local evidence

- Existing service and snapshot tests: 64 passed.
- Direct codec characterization tests: 6 passed.
- Fresh Worker type generation and typecheck: passed. Wrangler logged a local
  debug-log-directory warning; runtime types and the command completed normally.
- AST-based movement check: eleven moved functions, five retained functions,
  and the service class are unchanged except for the shared predicate call and
  export modifiers. The regular expression has no stateful flags.

- Independent source review passed. The six-candidate test-only aggregate on
  the current base passed 12,310 tests across 1,138 files, app/Worker typechecks,
  and build (18.39 seconds); all 3,198 tracked inputs stayed unchanged. This
  aggregate result is not a standalone full-suite or native-browser result.

## Next step and completion criteria

The required native CI must pass before merge is considered complete. No production or
real-device behavior has been verified by these local checks. Keep this change
on the same branch/PR and record the final release evidence here.
