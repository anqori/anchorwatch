#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCAD_FILE="${SCRIPT_DIR}/enclosure.scad"
OUT_DIR="${SCRIPT_DIR}/out"

usage() {
  cat <<'EOF'
Usage:
  cad/generate-stl.sh [all|base|cover|preview]

Targets:
  all      Export base + cover STL files (default)
  base     Export only base STL
  cover    Export only cover STL
  preview  Export assembly preview STL
EOF
}

target="${1:-all}"

case "${target}" in
  -h|--help|help)
    usage
    exit 0
    ;;
esac

if ! command -v openscad >/dev/null 2>&1; then
  echo "Error: openscad is not installed or not in PATH." >&2
  echo "Install OpenSCAD CLI, then re-run cad/generate-stl.sh." >&2
  exit 1
fi

if [ ! -f "${SCAD_FILE}" ]; then
  echo "Error: missing CAD source: ${SCAD_FILE}" >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"

render() {
  local part="$1"
  local output_name="$2"
  local output_file="${OUT_DIR}/${output_name}"

  openscad -q -D "part=\"${part}\"" -o "${output_file}" "${SCAD_FILE}"
  echo "Generated ${output_file}"
}

case "${target}" in
  all)
    render "base" "anchorwatch-base.stl"
    render "cover" "anchorwatch-cover.stl"
    ;;
  base)
    render "base" "anchorwatch-base.stl"
    ;;
  cover)
    render "cover" "anchorwatch-cover.stl"
    ;;
  preview)
    render "preview" "anchorwatch-preview.stl"
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
