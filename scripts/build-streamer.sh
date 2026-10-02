#!/bin/sh
set -eu
cd "$(dirname "$0")/../extensions/streamer"
export CGO_ENABLED=0
GOOS=linux GOARCH=amd64 go build -o ../compiled/streamer-linux_x64 .
GOOS=windows GOARCH=amd64 go build -o ../compiled/streamer-win_x64.exe .
