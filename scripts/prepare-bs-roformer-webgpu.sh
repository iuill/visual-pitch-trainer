#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

VENV_DIR=".tmp/onnx-tools"
REQUIREMENTS_FILE="scripts/requirements-bs-roformer-webgpu.txt"

if ! command -v uv >/dev/null 2>&1; then
  printf '%s\n' "uv is required. Rebuild the Dev Container or run .devcontainer/scripts/install-dev-tools.sh." >&2
  exit 1
fi

if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
  uv venv --python python3 "${VENV_DIR}"
fi

uv pip install --python "${VENV_DIR}/bin/python" --link-mode=copy --require-hashes --only-binary=:all: -r "${REQUIREMENTS_FILE}"
"${VENV_DIR}/bin/python" scripts/prepare-bs-roformer-webgpu.py "$@"
