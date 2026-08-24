#!/usr/bin/env bash
set -euo pipefail

readonly SKILLS_CLI_VERSION="1.5.23"
readonly DIAGRAM_DESIGN_COMMIT="648c2a597839301e06df1e7434a08bde9f42eed3"
readonly DIAGRAM_DESIGN_SOURCE="https://github.com/cathrynlavery/diagram-design/tree/${DIAGRAM_DESIGN_COMMIT}/skills/diagram-design"
readonly WRAPPER_SOURCE="scripts/agent-skills/studyplanner-diagram-explainer"
readonly CODEX_WRAPPER_DIR=".agents/skills/studyplanner-diagram-explainer"
readonly CLAUDE_WRAPPER_DIR=".claude/skills/studyplanner-diagram-explainer"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_root}"

command -v node >/dev/null 2>&1 || {
  echo "Node.js is required to install Diagram Design." >&2
  exit 1
}

command -v npm >/dev/null 2>&1 || {
  echo "npm is required to install Diagram Design." >&2
  exit 1
}

DISABLE_TELEMETRY=1 npx --yes "skills@${SKILLS_CLI_VERSION}" add "${DIAGRAM_DESIGN_SOURCE}" \
  --agent codex \
  --agent claude-code \
  --copy \
  -y

mkdir -p "${CODEX_WRAPPER_DIR}" "${CLAUDE_WRAPPER_DIR}"
cp "${WRAPPER_SOURCE}/SKILL.md" "${CODEX_WRAPPER_DIR}/SKILL.md"
cp "${WRAPPER_SOURCE}/SKILL.md" "${CLAUDE_WRAPPER_DIR}/SKILL.md"

printf 'Diagram Design %s installed for Codex and Claude Code.\n' "${DIAGRAM_DESIGN_COMMIT}"
