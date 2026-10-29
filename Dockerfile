# syntax=docker/dockerfile:1

FROM golang:1.27.3-alpine AS go-base
WORKDIR /src

# Download Go modules once and reuse across Go build stages.
COPY go.mod go.sum ./
RUN go mod download

FROM go-base AS go-clients
COPY cmd ./cmd
COPY internal ./internal

# Build one platform per job, two jobs in parallel. Building both binaries of a
# platform in a single `go build` invocation compiles their shared dependencies
# once; four independent builds would each recompile them from a cold cache and
# end up slower than building sequentially.
RUN set -eu; \
  mkdir -p /out/downloads /out/linux_amd64 /out/windows_amd64; \
  export CGO_ENABLED=0; \
  ( GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o /out/linux_amd64/ ./cmd/cli ./cmd/desktop ) & linux_pid=$!; \
  ( GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o /out/windows_amd64/ ./cmd/cli ./cmd/desktop ) & windows_pid=$!; \
  status=0; \
  wait "$linux_pid" || status=1; \
  wait "$windows_pid" || status=1; \
  test "$status" -eq 0; \
  mv /out/linux_amd64/cli /out/downloads/Drop-cli-linux_x64; \
  mv /out/linux_amd64/desktop /out/downloads/Drop-linux_x64; \
  mv /out/windows_amd64/cli.exe /out/downloads/Drop-cli-win_x64.exe; \
  mv /out/windows_amd64/desktop.exe /out/downloads/Drop-win_x64.exe; \
  rmdir /out/linux_amd64 /out/windows_amd64

FROM node:alpine AS frontend-build
WORKDIR /app/frontend

# Install dependencies first for better layer caching.
RUN npm i -g pnpm@latest
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm approve-builds --all

COPY frontend ./
RUN pnpm run build

FROM go-base AS backend-build
WORKDIR /src

# Commit SHA reported by /health.
ARG BUILD_SHA=dev

COPY cmd ./cmd
COPY internal ./internal
COPY embed.go ./
COPY downloads/README.txt ./downloads/README.txt

# Bring in the built frontend and downloaded client binaries.
COPY --from=frontend-build /app/frontend/build ./frontend/build
COPY --from=go-clients /out/downloads/ ./downloads/

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w -X main.buildSHA=${BUILD_SHA}" -o /out/backend ./cmd/backend

FROM scratch AS final

COPY --from=backend-build /out/backend /backend

ENV PORT=4321

EXPOSE 4321

CMD ["/backend"]