#!/usr/bin/env bash
set -euo pipefail

# Installs Chromium into the user cache only. No sudo.
# System libraries must already exist on the runner (see playwright-system-deps.sh).
pnpm exec playwright install chromium
