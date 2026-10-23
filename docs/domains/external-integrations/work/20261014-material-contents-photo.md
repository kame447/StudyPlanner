# Material contents photo import

Status: active; implementation prepared for integration
Base: `70953efd`; branch: `feature/material-contents-photo`

## Boundary

- Reuse the authenticated `/planning-attachment` endpoint, existing Luna image model, image size limits and attachment quota. No new provider, credential, deployment binding or storage schema.
- Only `purpose: material_contents_photo` selects the strict JSON schema and bounded all-or-nothing validator. Existing planning-image requests retain their prompt, result and output budget.
- Prefer this narrow extension over duplicating authentication/quota in a new endpoint or allowing arbitrary multimodal chat requests.
- A photograph becomes a local editable preview of up to 150 chapter/section/subsection rows. Unknown page numbers remain unset. Reject invalid hierarchy, empty titles, unsupported fields and invalid ranges.
- Applying the preview requires confirmation before replacing an existing draft. Saving remains the existing bookshelf structure editor action; dismissing or failed parsing does not mutate saved contents. Cancellation and a newer selection invalidate older completions.
- Page-unit materials receive page ranges. Other progress units receive headings and hierarchy only, with an explicit notice; page numbers are never interpreted as question/session counts.
- Images are sent transiently to the existing OpenAI provider after the UI disclosure. No raw image is added to material preferences, telemetry or a new image store. Existing usage observation records content-free metrics.

## Verification and remaining work

Focused suites: `MaterialContentsPhotoImport`, `materialContentsPhoto` (client and Worker), `workerRequestBudget`, `planningImageAttachment`, `aiProxyRequestObserver`, `traceWorker.aiObservation`, `BookshelfDialogs`, `bookshelfViewModel`. Use `DEV_LAN_HOST=127.0.0.1` for the existing Vite development-network configuration in this environment.

Run `npm run typecheck` (app + generated Worker runtime types) on final content. Integration owner owns final combined checks and publication. No live model/photo evaluation or browser visual checks were performed in this implementation task; mocked provider fixtures validate the contract, not OCR accuracy. Verify the final tests, resulting integration commit, CI and deployment before describing the released feature as complete.

Final implementation evidence (2026-10-14): the nine focused suites passed, 105 tests, exit 0; `npm run typecheck` passed, exit 0. Content is the branch's implementation commit including this record. Installed tools: TypeScript 5.9.3, Vitest 3.2.7, Wrangler 4.147.0, using the existing shared dependency installation; no dependency changes. `git diff --check` passed. These checks are not a combined-release/full-build proof.
