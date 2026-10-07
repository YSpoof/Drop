#!/bin/sh
set -eu
cd "$(dirname "$0")/../native/extensions/streamer"
mkdir -p ../compiled
export CGO_ENABLED=0
LDFLAGS='-s -w'
GOOS=linux GOARCH=amd64 go build -ldflags="$LDFLAGS" -o ../compiled/streamer-linux_x64 .
GOOS=windows GOARCH=amd64 go build -ldflags="$LDFLAGS" -o ../compiled/streamer-win_x64.exe .
