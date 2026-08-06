#!/usr/bin/env bash
set -euo pipefail

# One-time runner host setup. Run as root on the machine — not from CI.
# Example: sudo ./scripts/ci/playwright-system-deps.sh
if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root on the runner host (needs apt for Chromium system libraries)." >&2
  exit 1
fi

pnpm exec playwright install-deps chromium
