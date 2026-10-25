#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-${OUT_DIR:-$ROOT/dist}}"
cd "$ROOT/native"
mkdir -p "$OUT_DIR"
export CGO_ENABLED=0
LDFLAGS='-s -w'
GOOS=linux GOARCH=amd64 go build -ldflags="$LDFLAGS" -o "$OUT_DIR/Drop-linux_x64" ./desktop
GOOS=windows GOARCH=amd64 go build -ldflags="$LDFLAGS" -o "$OUT_DIR/Drop-win_x64.exe" ./desktop
