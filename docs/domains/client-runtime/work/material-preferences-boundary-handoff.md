# Material preferences boundary

Status: active local implementation, not published
Updated: 2026-10-20
Branch: `refactor/material-persistence-boundary`
Base: `22e42203a4df82b5432d4290b7b5ea3a4246b8c9`
PR: none

## Scope and decision

The material detail domain module combines activity/progress calculation with browser storage selection, persisted decoding and writes. Pure domain consumers transitively depend on the storage implementation. Separate the existing storage responsibility into a concrete repository facade, without introducing a generic service framework or another write path. UI keeps the same two-function read/save API. Domain types/defaults remain with the pure model.

Alternatives: extract a larger Bookshelf UI hook (more UI lifecycle risk, not needed for this boundary); change read/write failure behavior (separate defect/policy decision, excluded); isolate existing persistence responsibility (selected, directly verifiable through source dependency and original component/persistence contracts). A current active implementation of this same split or unchanged domain-to-storage imports would invalidate this choice.

Preflight: current open PR list, closed/open material-preferences PR and bookshelf-persistence issue searches, and material/bookshelf branches inspected. No active duplicate separation found. Existing material observation/readability branches and Issue805 are different scopes; do not change their tests or fixes. AGENTS architecture rules and client-runtime local storage/admission contracts reviewed. This auxiliary per-material preference store is not the canonical planner repository and must not be presented as a transaction or cross-client authority.

## Invariants and next action

Preserve owner-qualified v1 keys, serialized bytes, recursive read normalization/defaults, synchronous write acknowledgement, all existing error/SSR behavior and component flows. In particular, the existing read-side localStorage getter guard can throw before its try block; characterize but do not silently fix that behavior in a refactor. Keep the save-side denied getter returning false.

Next: characterize storage boundary on original code, move the persistence implementation, migrate both production consumers and test imports, add a pure-domain dependency guard, then run focused tests and types/build. Parent owns combined full verify/publication. No browser timing or assertions are changed. Completion requires exact diff, local tests, dependency boundary proof, and a reviewable local commit; no publication is authorized.

## Verified local candidate

- Existing key, decoding and read/write implementation preserved; repository now imports domain types/defaults, while domain activity/progress rules import no persistence facade. Only production UI import wiring changes. No second write path or storage migration introduced.
- Original six persistence cases retained at the repository owner, plus three characterization cases for missing storage, malformed/raw normalized bytes, getItem failure and the existing getter-denial asymmetry. Pre-refactor characterization: 9/9 pass. Post-extraction related component/domain cases: 59/59 pass. Final moved tests and narrow direct-source boundary guard: 10/10 pass. The source guard is not a full transitive import-graph proof.
- Independent domain review: no blocking findings; moved implementation and remaining domain/default functions compared with the base, production consumers contain only import changes.
- Final local `DEV_LAN_HOST=127.0.0.1 npm run verify`: exit 0. Fresh app/Worker types pass; 1,055 test files pass, 12 skipped; 10,532 tests pass, 67 skipped, 1 todo; production build passes with existing large-chunk warning. Skips are not new passing coverage. No lint command is configured.
- Verification input: base above plus the staged 13-file candidate; staged diff SHA256 `d38ef4894cf2485fd1b4e0a72fbce497dc241b6372415d0ee9a71e321bfbfdb8`. Only this documentation checkpoint changed after verification.
- Environment: Node24.19.0, Vitest3.2.7, Vite6.4.3, TypeScript5.9.3, Wrangler4.151.0. Final dependency installation checked against all242 installed manifest versions in lockfile (no required package missing), separate from the initial focused-only install using Wrangler4.151.1. Historical test fixture commit `070d25cbe14796aebb8168ac5425c93e3506df1c` fetched before full verification. Supported DEV_LAN_HOST overrides only dev URL discovery in the constrained shell, not test assertions or browser timing.
- Browser/native CI, publication and merge not performed. This is behavior-preserving storage responsibility separation, not a fix for Issue805's native frame delays or the existing read-denial asymmetry. Parent owns publication and applicable external gates.
