#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(readlink -f "${script_dir}/../..")"

if git config --global --get-all safe.directory 2>/dev/null | grep -Fqx "${repo_root}"; then
  exit 0
fi

git config --global --add safe.directory "${repo_root}"
