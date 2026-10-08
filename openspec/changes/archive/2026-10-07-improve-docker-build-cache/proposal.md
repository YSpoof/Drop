# Proposal

## Why

Go client stages already cache well when only the web app changes, but the Neutralino desktop package stage still rebuilds every time. That stage copies the full repo (`COPY . .`), so frequent `src/` edits bust an expensive shell package that barely depends on web code. Rebuilds waste CI/local Docker time for a thin remote-UI shell.

## What Changes

- Narrow the Docker `native` (Neutralino) stage inputs so layer cache survives web-only changes.
- Keep Go (`go-clients`) as an earlier stage; native packaging continues to consume compiled streamer binaries from that stage, then web build consumes native + CLI artifacts.
- Ensure web-only rebuilds still produce the same published `/downloads/` desktop + CLI artifacts (cached native binaries reused).
- Optionally tighten `.dockerignore` / explicit `COPY` paths so unrelated trees (e.g. `openspec/`, tests already ignored) do not invalidate native layers.

## Capabilities

### New Capabilities

- `docker-build-cache`: Production multi-stage Docker image build orders Go → Neutralino shell → web, and invalidates the Neutralino package stage only when native-shell inputs (or Go streamer outputs it embeds) change—not when web app sources change.

### Modified Capabilities

- `client-downloads`: Clarify that production Docker/CI may reuse a cached desktop package when only web sources change, while still shipping the required `/downloads/` filenames; streamer still compiles before packaging when streamer/native inputs change.

## Impact

- `Dockerfile` (`native` stage copy/order; possibly `build` stage unchanged aside from still taking `--from=native` / `--from=go-clients`).
- Possibly `.dockerignore` if broad ignores help without breaking native packaging inputs.
- No runtime API, Neutralino config URL/mode, or download filename changes expected.
- CI/local `docker build` time for web-only changes should drop (native `neu` package cached).
