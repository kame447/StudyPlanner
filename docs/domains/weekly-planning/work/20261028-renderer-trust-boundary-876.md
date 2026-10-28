# #876: free-form reply quality is not a planning authorization boundary

## Observed defect

A real gpt-6-luna reply, `ゼミ発表の資料を完成させる残りの作業は、全部で約45分くらいなんですね。`, repeated the accepted 45-minute approximate estimate for the remaining workload, but a grammar-limited display validator rejected it. The exact response and synthetic renderer input are in `src/features/weeklyPlanning/dialogue/fixtures/issue876-remaining-effort-renderer.json`.

A second minimal test, reproduced independently against untouched `origin/main` (487a5512), proved that the same validator accepts `英語は90分ですね。` when the typed facts actually say English 45 minutes and mathematics 90 minutes. Thus acceptance and rejection of free prose are both unreliable as evidence of semantic fidelity.

## Responsibility comparison

The existing production pipeline asks a model to write unrestricted Japanese and reinterprets it with regexes for subject, duration, precision, date, number of candidates and acceptance acknowledgement. For a newly accepted effort, a failed rendering step also discarded a correct preview and returned a technical error. This gives an incomplete natural-language checker undue authority over a successful semantic transaction.

Three alternatives were considered. Expanding regexes continually would preserve the false-acceptance gap. A second model as a mandatory verifier adds expense and a fallible additional gate, not deterministic safety. Fixed text templates could guarantee displayed factual fields, but would destroy the free-form dialogue behavior the product is designed for.

The chosen boundary is to keep free-form language generation. The application validates the typed semantic result, scheduling constraints, owner identity, approval, and save operations independently. A renderer's JSON envelope must still carry the selected action identity and kind; malformed output, unsafe destination/sensitive disclosures and obvious false claims of completed mutation remain limited presentation guardrails. A generated sentence cannot itself mutate the Fact Graph or authorize saving. Exact Japanese subject/duration/precision/date patterns are not acceptance conditions. They remain in an explicitly named legacy test oracle for historical observation, not the live pipeline.

For a renderer outage, the application uses a short *error-only* presentation fallback without removing independently validated unapproved candidates. This is not a template for successful dialogue, which continues to be model-generated. Pending questions on an outage remain machine-owned but not marked as presented, preserving the existing freshness contract.

## Intentional limitations and measurable quality

The live renderer can still say the wrong number or task. That is a model-quality defect, not a grant of authority. A finite regex cannot prove semantic correctness; the current limited high-impact guard cannot guarantee that all possible false success claims are recognized. The UI preview and later approval/save lifecycle must expose the actual typed candidate values and state rather than trusting a sentence. Evaluate Japanese grounding in live-model regression/Argon reviews separately. A renderer improvement must not be counted as a scheduling/authorization change.

Do not mark #876/#875 complete until relevant tests pass. In particular verify that (1) the real rejected text renders; (2) a wrong free text claim does not alter state or cause a save; (3) a renderer outage does not drop the accepted candidate; (4) no unauthorized mutation can be committed; (5) trace/outbox/retry/Worker limits still hold; (6) browser UI shows the typed, unapproved candidate and save control; and (7) the real-API ten-repetition audit reports qualitative errors without relying solely on the old regex veto. Timebox date freshness and TypedRenderer assertions are independent issues.

The initial full-suite run with a narrow regex experiment produced four independent 5,000 ms timeouts in unrelated heavy tests. They are not evidence of a green full suite and require classification/retesting with a controlled worker count.
