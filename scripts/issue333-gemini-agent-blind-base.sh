#!/usr/bin/env bash
# Creates a standalone git repository that contains only a blind judge packet
# (and an optional README), for use as the Orrery Gemini agent's source repo.
# The repository shares no objects or refs with StudyPlanner, so an agent
# worktree created from it cannot reach labels, mappings or candidate sources.
#
#   scripts/issue333-gemini-agent-blind-base.sh <new-repo-dir> <packet.json> [<task-readme.md>]
#     prints the single commit SHA; pass <new-repo-dir> as the spawn WORKDIR
#     and the SHA as --worktree-base.
#   scripts/issue333-gemini-agent-blind-base.sh --check <repo-dir>
#     verifies the repository holds exactly that one commit and lists its tree.
set -euo pipefail

usage() {
  echo "Usage: $0 <new-repo-dir> <packet.json> [<task-readme.md>]" >&2
  echo "       $0 --check <repo-dir>" >&2
  exit 2
}

check_repo() {
  local repo="$1"
  local commits
  commits="$(git -C "$repo" rev-list --all)"
  if [[ "$(printf '%s\n' "$commits" | grep -c .)" -ne 1 ]]; then
    echo "Blind base check failed: repository must contain exactly one commit." >&2
    exit 1
  fi
  local commit_sha="$commits"
  if [[ "$(git -C "$repo" rev-list --parents -n 1 "$commit_sha")" == *" "* ]]; then
    echo "Blind base check failed: commit has a parent." >&2
    exit 1
  fi
  local packet_count=0 readme_count=0 entry_count=0
  local metadata entry_name mode object_type object_sha
  while IFS=$'\t' read -r metadata entry_name; do
    [[ -n "$metadata" ]] || continue
    read -r mode object_type object_sha <<<"$metadata"
    if [[ "$mode" != "100644" || "$object_type" != "blob" || -z "$object_sha" ]]; then
      echo "Blind base check failed: tree contains a non-regular-file entry." >&2
      exit 1
    fi
    case "$entry_name" in
      packet.json) packet_count=$((packet_count + 1)) ;;
      README.md) readme_count=$((readme_count + 1)) ;;
      *) echo "Blind base check failed: unexpected path $entry_name" >&2; exit 1 ;;
    esac
    entry_count=$((entry_count + 1))
  done < <(git -C "$repo" ls-tree "$commit_sha")
  if [[ "$packet_count" -ne 1 || "$readme_count" -gt 1 || "$entry_count" -gt 2 ]]; then
    echo "Blind base check failed: expected packet.json and at most one README.md." >&2
    exit 1
  fi
  # Loose objects only: one commit, one tree, and one blob per file.
  local object_count
  object_count="$(find "$(git -C "$repo" rev-parse --absolute-git-dir)/objects" -type f -path '*/objects/??/*' | wc -l | tr -d ' ')"
  if [[ "$object_count" -ne $((entry_count + 2)) ]]; then
    echo "Blind base check failed: repository holds unexpected objects ($object_count)." >&2
    exit 1
  fi
  printf '%s\n' "$commit_sha"
  git -C "$repo" ls-tree "$commit_sha"
}

if [[ "${1:-}" == "--check" ]]; then
  [[ "$#" -eq 2 ]] || usage
  check_repo "$2"
  exit 0
fi

[[ "$#" -ge 2 && "$#" -le 3 ]] || usage
repo_dir="$1"
packet_path="$2"
readme_path="${3:-}"
[[ -f "$packet_path" ]] || { echo "Packet file not found: $packet_path" >&2; exit 1; }
if [[ -n "$readme_path" && ! -f "$readme_path" ]]; then
  echo "README file not found: $readme_path" >&2
  exit 1
fi
if [[ -e "$repo_dir" ]]; then
  echo "Refusing to reuse an existing path: $repo_dir" >&2
  exit 1
fi

mkdir -p "$repo_dir"
git init -q "$repo_dir"
cp "$packet_path" "$repo_dir/packet.json"
[[ -n "$readme_path" ]] && cp "$readme_path" "$repo_dir/README.md"
git -C "$repo_dir" add packet.json
[[ -n "$readme_path" ]] && git -C "$repo_dir" add README.md
git -C "$repo_dir" -c user.name='issue333-blind-base' -c user.email='blind-base@invalid' \
  -c commit.gpgsign=false commit -q -m 'Issue #333 Gemini agent blind judge packet'
check_output="$(check_repo "$repo_dir")"
printf '%s\n' "${check_output%%$'\n'*}"
