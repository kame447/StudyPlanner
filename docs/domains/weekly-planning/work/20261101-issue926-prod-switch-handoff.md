# #926 delegated production switch checkpoint

Owner: RoseEinstein, parent PurplePasteur. Integration Issue #926, PR #928,
branch `feat/issue926-vnext-conversation-core`; delegated worktree branch
`exp/RoseEinstein`, base/HEAD `a5946cc9b82c546f253acfdf466b7ba03a380f14`.
Changes are uncommitted; the parent owns commit, integration and release.

## Scope and decisions

- VNext is the default; V5 requires build env `VITE_WEEKLY_PLANNING_CORE=stable_v5`
  and a local development host. Ordinary builds compile out the V5 application hook.
- Reuse the existing chat index, search cache and chat navigation state machine with
  injected snapshot ports. Each chat gets an independent VNext checkpoint.
- Migrate valid V5 chat bytes read-only with a revision bump. Preserve invalid legacy
  bytes and start a clean interactive conversation. Never revive old preview authority.
- Parent added multi-chat/reset parity and hook-side durable receipt resume/cancellation.
  SharpHopper owns starter-target changes; WindyFranklin owns gateway/Worker/client types.

## Evidence and next action

- Node v22.23.4, npm ci completed (225 installed packages). Default fnm state directory
  was outside the sandbox; `XDG_STATE_HOME=/tmp/rose-fnm-state` permits normal fnm setup.
- Initial typecheck succeeded. Initial focused run: 33 pass / 3 fail, all three used
  the old weekly storage namespace after introducing chat-owned storage. Updated those
  readers to the active chat namespace and added migration/navigation regressions.
- `origin/main` baseline `cd3fae2ba592439b197514d7c427dabfa406e852` built from a
  git archive at `/tmp/rose-prod-switch-main` using the same installed dependencies;
  build and budget exited 0. JSON: `/tmp/rose-prod-switch-main/artifacts/quality-gate/bundle-budget.json`.
- Next: finish focused verification, wire durable receipt resume/cancel, run typecheck,
  full test:run, production build and bundle budget, and report exact counts/deltas.

## Definition of done

Selection, non-destructive migration, multi-chat/reset and durable hook integration
implemented; focused/full tests, typecheck and build successful on the final dirty tree;
bundle numbers compared with origin/main (budget changes remain the parent's decision).
Parent receives exact paths, commands, results and remaining risks over ORRERY Mail.
