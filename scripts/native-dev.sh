#!/bin/sh
set -eu

repo_root=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
cd "$repo_root"

pnpm run dev &
dev_pid=$!

cleanup() {
	kill "$dev_pid" 2>/dev/null || true
	wait "$dev_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cd "$repo_root/native"
go run ./desktop --url=http://localhost:4321