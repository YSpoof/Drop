#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-${OUT_DIR:-$ROOT/static/downloads}}"
cd "$ROOT/native"
mkdir -p "$OUT_DIR"
export CGO_ENABLED=0
LDFLAGS='-s -w'
GOOS=linux GOARCH=amd64 go build -ldflags="$LDFLAGS" -o "$OUT_DIR/Drop-cli-linux_x64" ./cli/cmd/dropcli
GOOS=windows GOARCH=amd64 go build -ldflags="$LDFLAGS" -o "$OUT_DIR/Drop-cli-win_x64.exe" ./cli/cmd/dropcli
