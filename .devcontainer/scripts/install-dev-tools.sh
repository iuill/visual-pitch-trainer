#!/usr/bin/env bash

set -euo pipefail

ensure_line_in_file() {
  local file_path="$1"
  local line="$2"

  touch "${file_path}"

  if ! grep -Fqx "${line}" "${file_path}"; then
    printf '%s\n' "${line}" >>"${file_path}"
  fi
}

get_codex_version() {
  "${BUN_INSTALL}/bin/codex" --version 2>/dev/null | awk '{print $NF}' || true
}

install_missing_apt_packages() {
  local packages_to_install=()

  command -v rg >/dev/null 2>&1 || packages_to_install+=(ripgrep)
  command -v bwrap >/dev/null 2>&1 || packages_to_install+=(bubblewrap)

  if [ ${#packages_to_install[@]} -eq 0 ]; then
    return 0
  fi

  sudo apt-get update
  DEBIAN_FRONTEND=noninteractive sudo apt-get install -y --no-install-recommends "${packages_to_install[@]}"
}

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="${BUN_INSTALL}/bin:/workspace/.devcontainer/bin:${PATH}"

OPENAI_CODEX_VERSION="${OPENAI_CODEX_VERSION:-0.125.0}"

install_missing_apt_packages

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  export PATH="${BUN_INSTALL}/bin:${PATH}"
fi

ensure_line_in_file "${HOME}/.bashrc" 'export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"'
ensure_line_in_file "${HOME}/.bashrc" 'export PATH="$BUN_INSTALL/bin:$PATH"'
ensure_line_in_file "${HOME}/.bashrc" 'export PATH="/workspace/.devcontainer/bin:$PATH"'
ensure_line_in_file "${HOME}/.profile" 'export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"'
ensure_line_in_file "${HOME}/.profile" 'export PATH="$BUN_INSTALL/bin:$PATH"'
ensure_line_in_file "${HOME}/.profile" 'export PATH="/workspace/.devcontainer/bin:$PATH"'

if [ -f bun.lock ] || [ -f bun.lockb ]; then
  bun install --frozen-lockfile
else
  bun install
fi

if [ "$(get_codex_version)" != "${OPENAI_CODEX_VERSION}" ]; then
  bun add -g "@openai/codex@${OPENAI_CODEX_VERSION}"
fi

if [ ! -x "${BUN_INSTALL}/bin/codex" ]; then
  printf '%s\n' "codex was not installed at ${BUN_INSTALL}/bin/codex" >&2
  exit 1
fi

printf 'node: %s\n' "$(node --version)"
printf 'bun: %s\n' "$(bun --version)"
printf 'gh: %s\n' "$(gh --version | head -n1)"
printf 'codex: %s\n' "$(codex --version)"
