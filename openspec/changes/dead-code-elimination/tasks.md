# Tasks

## 1. Remove compiler-confirmed dead members

- [x] 1.1 Remove the unused `downloads` field from `src/lib/services/transferService.ts` while retaining the environment-dependent native file-reader callback; verify with `pnpm exec tsc --noEmit --noUnusedLocals --noUnusedParameters --pretty false`.
- [x] 1.2 Remove the unused `downloads` and `environment` fields from `src/lib/utils/webrtc/transfer.ts`; verify transfer manager construction and control/data handling still type-check with the strict TypeScript command.
- [x] 1.3 Rename or otherwise eliminate the unused `groupId` parameter in `QueueService.addWatchedFile` without changing the folder-watcher callback contract; verify `pnpm exec svelte-check --tsconfig ./tsconfig.json --tsgo` passes.

## 2. Prune repository-unreferenced utility exports

- [x] 2.1 Reconfirm whole-repository references and configuration entry points, then remove only `streamerSession`, `formatEta`, `formatPercent`, `totalQueueBytes`, and `isPrivateIp`; verify the retained exports compile and `rg` finds no remaining consumers requiring those symbols.
- [x] 2.2 Ensure framework/configuration entry points and Vite-loaded signaling handler remain unchanged; verify `pnpm exec svelte-check --tsconfig ./tsconfig.json --tsgo` and strict unused-symbol TypeScript analysis both pass.

## 3. Validate the behavior-preserving cleanup

- [x] 3.1 Run the production build with `pnpm build` and verify it completes without missing-module or bundling errors.
- [x] 3.2 Run the existing end-to-end suite with `pnpm test:e2e` and verify the browser transfer and navigation flows remain green; record any environment-only failure separately.
