#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

timestamp_utc() {
  date -u +"%Y%m%d%H%M%S"
}

current_commit_short() {
  jj log --no-graph -r @ -T 'commit_id.short() ++ "\n"' | head -n 1 | tr -d '[:space:]'
}

working_copy_is_empty() {
  local is_empty
  is_empty="$(jj log --no-graph -r @ -T 'if(empty, "1", "0") ++ "\n"' | head -n 1 | tr -d '[:space:]')"
  [[ "$is_empty" == "1" ]]
}

semver_from_text() {
  local text="$1"
  awk '{for(i=1;i<=NF;i++) print $i}' <<<"$text" | rg '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1 || true
}

tag_for_revision() {
  local rev="$1"
  local raw
  raw="$(jj log --no-graph -r "tags() & ${rev}" -T 'tags ++ "\n"' 2>/dev/null || true)"
  semver_from_text "$raw"
}

current_release_tag() {
  local direct_tag
  direct_tag="$(tag_for_revision '@')"
  if [[ -n "$direct_tag" ]]; then
    echo "$direct_tag"
    return 0
  fi

  if working_copy_is_empty; then
    local parent_tag
    parent_tag="$(tag_for_revision '@-')"
    if [[ -n "$parent_tag" ]]; then
      echo "$parent_tag"
      return 0
    fi
  fi

  return 1
}

ensure_clean_working_copy() {
  if jj status --quiet | rg -q '^Working copy changes:'; then
    echo "Working copy is not clean; commit or discard changes before release." >&2
    exit 1
  fi
}

next_release_tag() {
  local latest
  latest="$(jj tag list | awk -F: '/^v[0-9]+\.[0-9]+\.[0-9]+:/ {print $1}' | sort -V | tail -n 1)"
  if [[ -z "$latest" ]]; then
    echo "v0.1.0"
    return 0
  fi

  local major minor patch
  IFS='.' read -r major minor patch <<<"${latest#v}"
  patch="$((patch + 1))"
  echo "v${major}.${minor}.${patch}"
}

create_next_release_tag() {
  ensure_clean_working_copy
  local tag
  tag="$(next_release_tag)"
  jj tag set "$tag" -r @ >/dev/null
  echo "$tag"
}

case "${1:-}" in
  run-id)
    echo "run-$(timestamp_utc)"
    ;;
  dev-id)
    echo "dev-$(current_commit_short)-$(timestamp_utc)"
    ;;
  release-id)
    current_release_tag
    ;;
  firmware-id)
    if tag="$(current_release_tag 2>/dev/null)"; then
      echo "$tag"
    else
      echo "run-$(timestamp_utc)"
    fi
    ;;
  next-release-tag)
    next_release_tag
    ;;
  create-next-release-tag)
    create_next_release_tag
    ;;
  ensure-clean)
    ensure_clean_working_copy
    ;;
  *)
    echo "Usage: $0 {run-id|dev-id|release-id|firmware-id|next-release-tag|create-next-release-tag|ensure-clean}" >&2
    exit 2
    ;;
esac
