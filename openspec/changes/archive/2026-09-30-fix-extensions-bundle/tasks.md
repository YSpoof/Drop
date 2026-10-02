# Tasks

## 1. Resource Preparation

- [x] 1.1 Create `/resources/extensions/` directory in project structure
- [x] 1.2 Update build process to copy compiled streamer binaries to `/resources/extensions/` during packaging
- [x] 1.3 Verify resources are correctly packaged by checking generated `.neu` file contains extensions

## 2. Neutralino Configuration Updates

- [x] 2.1 Modify `neutralino.config.json` to use placeholder paths for extensions that will be replaced at runtime
- [x] 2.2 Keep `enableExtensions: true` to leverage Neutralino's built-in extension lifecycle management
- [x] 2.3 Verify Neutralino starts without errors with updated configuration

## 3. Runtime Extraction Implementation

- [x] 3.1 Add resource extraction logic in `src/lib/adapters/native/neutralinoClient.ts` before `Neutralino.init()`
- [x] 3.2 Implement platform detection to select correct extension binary (Linux vs Windows)
- [x] 3.3 Extract extension binaries from `/resources/extensions/` to writable temporary directory using `Neutralino.resources.extractFile()`
- [x] 3.5 Add error handling for extraction failures with appropriate logging

## 4. Build Process Updates

- [x] 4.1 Update `scripts/build-streamer.sh` to also copy binaries to resources directory
- [x] 4.2 Modify `package.json` native build script to include resources preparation step
- [x] 4.3 Ensure both `native:dev` and `native:build` workflows correctly handle resource copying

## 5. Verification and Testing

- [x] 5.1 Verify extension extracts successfully at runtime by checking temporary directory
- [x] 5.2 Confirm extension launches and communicates with application (streamerReady event received)
- [x] 5.3 Test native file transfers still work correctly with extracted extension
- [x] 5.4 Verify cleanup of temporary extracted files on application exit
- [x] 5.5 Test both Linux and Windows extension binaries (where applicable)

## 6. Documentation

- [x] 6.1 Update any relevant documentation comments in code explaining the extraction process
- [x] 6.2 Ensure README or other docs reflect new bundling approach if needed