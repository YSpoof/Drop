# syntax=docker/dockerfile:1

ARG LINUX_TARGET=x86_64-unknown-linux-musl
ARG WINDOWS_TARGET=x86_64-pc-windows-gnu

FROM rust:alpine AS chef
ARG WINDOWS_TARGET
RUN apk add --no-cache musl-dev mingw-w64-gcc \
  && rustup target add "$WINDOWS_TARGET" \
  && cargo install cargo-chef --locked
WORKDIR /src

FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN cargo chef prepare --recipe-path recipe.json

# CLI and desktop for both targets. Depends only on Rust sources, so a
# frontend-only change keeps this stage cached.
FROM chef AS clients
ARG LINUX_TARGET
ARG WINDOWS_TARGET
COPY .cargo ./.cargo
COPY --from=planner /src/recipe.json recipe.json
RUN cargo chef cook --release -p drop-cli -p drop-desktop \
  --target "$LINUX_TARGET" --target "$WINDOWS_TARGET" --recipe-path recipe.json
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN cargo build --release -p drop-cli -p drop-desktop --target "$LINUX_TARGET" --target "$WINDOWS_TARGET" \
  && mkdir -p /out/downloads \
  && cp "target/$LINUX_TARGET/release/drop-cli" /out/downloads/Drop-cli-linux_x64 \
  && cp "target/$LINUX_TARGET/release/drop-desktop" /out/downloads/Drop-linux_x64 \
  && cp "target/$WINDOWS_TARGET/release/drop-cli.exe" /out/downloads/Drop-cli-win_x64.exe \
  && cp "target/$WINDOWS_TARGET/release/drop-desktop.exe" /out/downloads/Drop-win_x64.exe

FROM node:alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN npm i -g "$(node -p 'require("./package.json").packageManager')"
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm approve-builds --all
COPY frontend ./
RUN pnpm run build

# Backend embeds the frontend build and the four client binaries.
FROM chef AS backend
ARG LINUX_TARGET
COPY --from=planner /src/recipe.json recipe.json
RUN cargo chef cook --release -p drop-backend --target "$LINUX_TARGET" --recipe-path recipe.json
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY downloads/README.txt ./downloads/README.txt
COPY --from=frontend /app/frontend/build ./frontend/build
COPY --from=clients /out/downloads/ ./downloads/
# Commit SHA reported by /health. Declared late so it does not bust the cook cache.
ARG BUILD_SHA=dev
RUN BUILD_SHA="$BUILD_SHA" cargo build --release -p drop-backend --target "$LINUX_TARGET" \
  && cp "target/$LINUX_TARGET/release/drop-backend" /backend

FROM scratch
COPY --from=backend /backend /backend
ENV PORT=4321
EXPOSE 4321
CMD ["/backend"]
