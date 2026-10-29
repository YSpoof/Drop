.PHONY: build dev test clean

build: frontend-build
	CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/backend ./cmd/backend

frontend-build:
	pnpm --dir frontend install --frozen-lockfile --ignore-scripts
	cd frontend && pnpm approve-builds --all
	pnpm --dir frontend run build

dev:
	@echo "Starting backend and Vite dev server..."
	go run ./cmd/backend & \
	pnpm --dir frontend run dev

test:
	go test ./...
	PORT=8080 go run ./cmd/backend & BACKEND_PID=$$!; \
	trap 'kill $$BACKEND_PID' EXIT INT TERM; \
	pnpm --dir frontend exec playwright test; \
	status=$$?; kill $$BACKEND_PID; exit $$status

clean:
	rm -rf bin frontend/build frontend/.svelte-kit