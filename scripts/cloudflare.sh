#!/usr/bin/env bash
set -euo pipefail

err() {
  echo "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || err "Missing required command: $1"
}

require_env() {
  local key
  for key in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID; do
    [[ -n "${!key:-}" ]] || err "$key is required"
  done
}

cf_api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  if [[ -n "$data" ]]; then
    curl -sS -X "$method" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$data" \
      "https://api.cloudflare.com/client/v4${path}"
  else
    curl -sS -X "$method" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      "https://api.cloudflare.com/client/v4${path}"
  fi
}

ensure_pages_project() {
  local project="$1"
  local production_branch="$2"

  local response
  response="$(cf_api GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${project}")"

  if jq -e '.success == true' >/dev/null <<<"$response"; then
    echo "Pages project exists: ${project}"
    return
  fi

  if jq -e '.errors[]? | select(.code == 8000007)' >/dev/null <<<"$response"; then
    echo "Creating Pages project: ${project} (production branch: ${production_branch})"
    npx --yes wrangler pages project create "${project}" --production-branch "${production_branch}"
    return
  fi

  echo "Failed to query Pages project ${project}" >&2
  echo "$response" | jq >&2 || true
  exit 1
}

ensure_pages_domain() {
  local project="$1"
  local domain="$2"
  local project_response project_subdomain

  project_response="$(cf_api GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${project}")"
  if ! jq -e '.success == true and .result.subdomain != null' >/dev/null <<<"$project_response"; then
    echo "Failed to load Pages project details for ${project}" >&2
    echo "$project_response" | jq >&2 || true
    exit 1
  fi
  project_subdomain="$(jq -r '.result.subdomain' <<<"$project_response")"

  local list_response
  list_response="$(cf_api GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${project}/domains")"

  if ! jq -e '.success == true' >/dev/null <<<"$list_response"; then
    echo "Failed to list Pages domains for ${project}" >&2
    echo "$list_response" | jq >&2 || true
    exit 1
  fi

  if jq -e --arg domain "$domain" '.result[]? | select(.name == $domain)' >/dev/null <<<"$list_response"; then
    local status existing_error
    status="$(jq -r --arg domain "$domain" '.result[] | select(.name == $domain) | .status' <<<"$list_response")"
    existing_error="$(jq -r --arg domain "$domain" '.result[] | select(.name == $domain) | (.verification_data.error_message // "")' <<<"$list_response")"
    if [[ "$status" == "active" ]]; then
      echo "Pages domain active: ${domain} -> ${project}"
      return
    fi
    echo "Pages domain ${domain} is attached but status is '${status}'." >&2
    if [[ -n "$existing_error" ]]; then
      echo "Cloudflare verification: ${existing_error}" >&2
    fi
    echo "Create/verify DNS CNAME: ${domain} -> ${project_subdomain}" >&2
    exit 1
  fi

  echo "Attaching Pages domain: ${domain} -> ${project}"
  local create_payload create_response
  create_payload="$(jq -nc --arg name "$domain" '{name: $name}')"
  create_response="$(cf_api POST "/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${project}/domains" "$create_payload")"

  if jq -e '.success == true' >/dev/null <<<"$create_response"; then
    local created_status created_error
    created_status="$(jq -r '.result.status // "unknown"' <<<"$create_response")"
    created_error="$(jq -r '.result.verification_data.error_message // empty' <<<"$create_response")"
    if [[ "$created_status" == "active" ]]; then
      echo "Pages domain attached: ${domain}"
      return
    fi
    echo "Pages domain ${domain} attached with status '${created_status}'." >&2
    if [[ -n "$created_error" ]]; then
      echo "Cloudflare verification: ${created_error}" >&2
    fi
    echo "Create/verify DNS CNAME: ${domain} -> ${project_subdomain}" >&2
    exit 1
  fi

  echo "Failed to attach Pages domain ${domain} to ${project}" >&2
  echo "$create_response" | jq >&2 || true
  exit 1
}

usage() {
  cat <<USAGE
Usage:
  scripts/cloudflare.sh ensure-pages-project <project> <production-branch>
  scripts/cloudflare.sh ensure-pages-domain <project> <domain>
  scripts/cloudflare.sh check-worker-route-access <worker-domain>
USAGE
}

check_worker_route_access() {
  local worker_domain="$1"
  local zone_name zone_response zone_id routes_response

  zone_name="$(awk -F. '{ if (NF < 2) { exit 1 } print $(NF-1) "." $NF }' <<<"$worker_domain")" \
    || err "Could not infer zone from worker domain: ${worker_domain}"

  zone_response="$(cf_api GET "/zones?name=${zone_name}")"
  if ! jq -e '.success == true and (.result | length) > 0' >/dev/null <<<"$zone_response"; then
    echo "Failed to resolve Cloudflare zone for ${zone_name}" >&2
    echo "$zone_response" | jq >&2 || true
    exit 1
  fi

  zone_id="$(jq -r '.result[0].id' <<<"$zone_response")"
  routes_response="$(cf_api GET "/zones/${zone_id}/workers/routes")"
  if jq -e '.success == true' >/dev/null <<<"$routes_response"; then
    echo "Worker route API access OK for zone ${zone_name}"
    return
  fi

  echo "Missing permission to manage Worker routes for zone ${zone_name}." >&2
  echo "Add token permission: Zone -> Workers Routes:Edit (and Zone:Read)." >&2
  echo "$routes_response" | jq >&2 || true
  exit 1
}

main() {
  require_cmd jq
  require_cmd curl
  require_env

  local cmd="${1:-}"
  case "$cmd" in
    ensure-pages-project)
      [[ $# -eq 3 ]] || err "ensure-pages-project requires <project> <production-branch>"
      ensure_pages_project "$2" "$3"
      ;;
    ensure-pages-domain)
      [[ $# -eq 3 ]] || err "ensure-pages-domain requires <project> <domain>"
      ensure_pages_domain "$2" "$3"
      ;;
    check-worker-route-access)
      [[ $# -eq 2 ]] || err "check-worker-route-access requires <worker-domain>"
      check_worker_route_access "$2"
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
