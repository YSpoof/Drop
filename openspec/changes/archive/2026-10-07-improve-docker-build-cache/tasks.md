# Tasks

## 1. Narrow native Docker stage inputs

- [x] 1.1 In `Dockerfile` `native` stage, replace `COPY . .` with explicit copies of Neutralino packaging inputs (`package.json`, lock/workspace files, `neutralino.config.json`, icon path `static/images/pwa/512.png`, plus any other path `neu` requires) and keep `COPY --from=go-clients` of `native/extensions/compiled/` before `native:update` / `native:build`; verify `docker build` completes and the image still serves `Drop-linux_x64`, `Drop-win_x64.exe`, `Drop-cli-linux_x64`, and `Drop-cli-win_x64.exe` under `/downloads/`
- [x] 1.2 If a missing path breaks packaging, add only that path to the explicit COPY list (do not restore full-tree `COPY . .`) and verify `docker build` succeeds again
- [x] 1.3 Optionally ignore build-irrelevant trees in `.dockerignore` (e.g. `openspec/`) only when the web `build` stage does not need them; verify a web-only file under `src/` is still available to the `build` stage

## 2. Cache behavior checks

- [x] 2.1 After a successful baseline image build, change only a web source file under `src/` and rebuild; verify Docker reports cache hits for `go-clients` and `native` while the web `build` stage reruns
- [x] 2.2 Change a Neutralino packaging input (e.g. `neutralino.config.json`) and rebuild; verify the `native` stage rebuilds and desktop binaries under `/downloads/` are still present
