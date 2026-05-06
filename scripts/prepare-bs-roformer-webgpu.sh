#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

VENV_DIR=".tmp/onnx-tools"

if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
  python3 -m venv "${VENV_DIR}"
fi

"${VENV_DIR}/bin/python" -m pip install --upgrade pip
"${VENV_DIR}/bin/python" -m pip install onnx onnxconverter-common numpy
"${VENV_DIR}/bin/python" scripts/prepare-bs-roformer-webgpu.py "$@"
