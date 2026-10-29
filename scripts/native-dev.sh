#!/bin/sh
set -eu

repo_root=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
cd "$repo_root"

# Start Go backend (dev port to avoid clashing with Vite on 4321)
PORT=8080 go run ./cmd/backend &
backend_pid=$!

# Start Vite dev server
pnpm --dir frontend run dev &
dev_pid=$!

cleanup() {
	kill "$backend_pid" "$dev_pid" 2>/dev/null || true
	wait "$backend_pid" "$dev_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cd "$repo_root"
go run ./cmd/desktop --url=http://localhost:4321