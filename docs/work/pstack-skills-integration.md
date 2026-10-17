# pstack Skills integration (opt-in)

This repository includes four adapted pstack Agent Skills under `.claude/skills/`: `pstack-tdd`, `pstack-show-work`, `pstack-blast-radius`, and `pstack-technical-writing`. They are committed to GitHub, so a normal `git pull` brings them to a local checkout. No marketplace installation or post-pull script is required.

Original source: https://github.com/backnotprop/pstack (mirror of Cursor pstack). These are intentionally limited adaptations, not the complete pstack distribution. Review upstream licensing and updates before importing more files.

Orrery retains responsibility for agent creation, model selection, concurrency, worktrees, PRs and merge control. The skills are invoked explicitly when relevant, and do not install `poteto-mode`, `swarm`, `arena`, hooks, or automatic routing. Follow repository `AGENTS.md` first.

After pulling, start a fresh Claude Code session in the repository and confirm that all four skills are discoverable. For a suitable bug, explicitly request `pstack-tdd`; for long-running tasks request `pstack-show-work`; for change-impact analysis request `pstack-blast-radius`; for documentation request `pstack-technical-writing`. This repository-only change has not been runtime-verified on the user's offline Mac or within Orrery.
