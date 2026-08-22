# UI home-screen redesign merge-readiness handoff

Status: closed / merged
Closed: 2026-08-22
Repository: `kame447/StudyPlanner`
Branch: `ui/home-screen-redesign`
PR: #162
Final branch HEAD: `a5577c6d248481698d3709f5f39633fd75a41fc7`
Squash merge: `daab919695f0ea3f5d29edcd64993c6afac245c3`

## Result

The primary StudyPlanner UI redesign was merged to `main` through PR #162.

The merged scope includes Home, Schedule, AI Planning, Bookshelf, Timetable, persistent primary chrome, responsive behavior, dark mode, keyboard/motion hardening, and the AI-planning hardening accumulated on the branch.

## Final verification

Before merge on the exact final branch HEAD:

- branch behind current `main`: 0
- GitHub mergeability: mergeable
- unresolved review threads: 0
- CI #4083: success
- Browser Regression #1357: success
- Chromium browser regression: 150 / 150 passed
- production build: success

Known non-blocking debt at merge remained the Vite >500 kB chunk warning; the main JS bundle was about 849.69 kB minified / 229.46 kB gzip.

## Follow-up boundary

PR #166 and Issue #167 are independent follow-up QA/accessibility work and are not part of PR #162's completed merge unit.

The detailed pre-merge investigation remains available in repository history and the PR #162 timeline. This file is retained only as the closed checkpoint summary and must not be treated as an active task.
