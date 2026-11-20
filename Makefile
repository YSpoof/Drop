.PHONY: build build-backend build-cli build-desktop frontend-build dev dev-desktop preview-desktop test clean

# Honors a global target-dir from cargo config.
TARGET_DIR = $(shell cargo metadata --format-version 1 --no-deps | sed -n 's/.*"target_directory":"\([^"]*\)".*/\1/p')
LINUX_TARGET := x86_64-unknown-linux-musl
WINDOWS_TARGET := x86_64-pc-windows-gnu
CLIENT_TARGETS := --target $(LINUX_TARGET) --target $(WINDOWS_TARGET)
# CLI binaries go where the backend embeds them; desktop binaries stay local.
CLI_OUT ?= downloads
DESKTOP_OUT ?= dist

# ring compiles C for musl; its code is freestanding, so host gcc works without a musl toolchain.
ifeq ($(shell command -v x86_64-linux-musl-gcc || command -v musl-gcc),)
export CC_x86_64_unknown_linux_musl ?= gcc
endif

# Clients first so the backend embeds the fresh CLI.
build: build-cli build-desktop build-backend

build-backend: frontend-build
	cargo build --release -p drop-backend
	mkdir -p bin
	cp $(TARGET_DIR)/release/drop-backend bin/backend

build-cli:
	cargo build --release -p drop-cli $(CLIENT_TARGETS)
	mkdir -p $(CLI_OUT)
	cp $(TARGET_DIR)/$(LINUX_TARGET)/release/drop-cli $(CLI_OUT)/Drop-cli-linux_x64
	cp $(TARGET_DIR)/$(WINDOWS_TARGET)/release/drop-cli.exe $(CLI_OUT)/Drop-cli-win_x64.exe

build-desktop:
	cargo build --release -p drop-desktop $(CLIENT_TARGETS)
	mkdir -p $(DESKTOP_OUT)
	cp $(TARGET_DIR)/$(LINUX_TARGET)/release/drop-desktop $(DESKTOP_OUT)/Drop-linux_x64
	cp $(TARGET_DIR)/$(WINDOWS_TARGET)/release/drop-desktop.exe $(DESKTOP_OUT)/Drop-win_x64.exe

frontend-build:
	pnpm --dir frontend install --frozen-lockfile --ignore-scripts
	cd frontend && pnpm approve-builds --all
	pnpm --dir frontend run build

# Backend on 8080; Vite on 4321 proxies /ws to it.
dev:
	@echo "Starting backend (8080) and Vite dev server (4321)..."
	PORT=8080 cargo run -p drop-backend & \
	pnpm --dir frontend run dev

# Backend, Vite, and the desktop host on the dev origin; closing the window stops all three.
dev-desktop:
	PORT=8080 cargo run -p drop-backend & BACKEND_PID=$$!; \
	pnpm --dir frontend run dev & VITE_PID=$$!; \
	trap 'kill $$BACKEND_PID $$VITE_PID 2>/dev/null; wait $$BACKEND_PID $$VITE_PID 2>/dev/null' EXIT INT TERM; \
	DROP_URL=http://localhost:4321 cargo run -p drop-desktop

preview-desktop:
	./$(DESKTOP_OUT)/Drop-linux_x64

test:
	cargo test --workspace
	cargo build -p drop-backend
	PORT=8080 $(TARGET_DIR)/debug/drop-backend & BACKEND_PID=$$!; \
	trap 'kill $$BACKEND_PID' EXIT; \
	pnpm --dir frontend exec playwright test

clean:
	rm -rf bin frontend/build frontend/.svelte-kit target
