#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <packet.json> [<task-readme.md>]" >&2
  echo "       $0 --check <commit-sha>" >&2
  exit 2
}

check_commit() {
  local commit_sha="$1"
  git cat-file -e "${commit_sha}^{commit}"

  local parent_line
  parent_line="$(git rev-list --parents -n 1 "$commit_sha")"
  # A blind base is a root commit: rev-list must print only the commit itself.
  if [[ "$parent_line" == *" "* ]]; then
    echo "Blind base check failed: commit has a parent." >&2
    exit 1
  fi

  local entry_count=0
  local packet_count=0
  local readme_count=0
  local mode object_type object_sha entry_name
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
      *)
        echo "Blind base check failed: unexpected path $entry_name" >&2
        exit 1
        ;;
    esac
    entry_count=$((entry_count + 1))
  done < <(git ls-tree "$commit_sha")

  if [[ "$packet_count" -ne 1 || "$readme_count" -gt 1 || "$entry_count" -lt 1 || "$entry_count" -gt 2 ]]; then
    echo "Blind base check failed: expected packet.json and at most one README.md." >&2
    exit 1
  fi
  git ls-tree "$commit_sha"
}

git rev-parse --git-dir >/dev/null

if [[ "${1:-}" == "--check" ]]; then
  [[ "$#" -eq 2 ]] || usage
  check_commit "$2"
  exit 0
fi

[[ "$#" -ge 1 && "$#" -le 2 ]] || usage
packet_path="$1"
readme_path="${2:-}"
[[ -f "$packet_path" ]] || { echo "Packet file not found: $packet_path" >&2; exit 1; }
if [[ -n "$readme_path" && ! -f "$readme_path" ]]; then
  echo "README file not found: $readme_path" >&2
  exit 1
fi

packet_blob="$(git hash-object -w -- "$packet_path")"
if [[ -n "$readme_path" ]]; then
  readme_blob="$(git hash-object -w -- "$readme_path")"
  tree_sha="$({
    printf '100644 blob %s\tREADME.md\n' "$readme_blob"
    printf '100644 blob %s\tpacket.json\n' "$packet_blob"
  } | git mktree)"
else
  tree_sha="$(printf '100644 blob %s\tpacket.json\n' "$packet_blob" | git mktree)"
fi

commit_sha="$(printf '%s\n' 'Issue #333 Gemini agent blind judge packet' | git commit-tree "$tree_sha")"
check_commit "$commit_sha" >/dev/null
printf '%s\n' "$commit_sha"
