# Design

## Context
See proposal.md - Why: Currently extensions are referenced directly via `commandLinux` and `commandWindows` in neutralino.config.json, requiring them to exist as separate files alongside the binary. This prevents bundling extensions within application resources for single-binary distribution.

The streamer extension is currently built and placed in `/extensions/compiled/` directory, referenced in neutralino.config.json as:
```json
"extensions": [
  {
    "id": "br.com.lzart.drop.streamer",
    "commandLinux": "${NL_PATH}/streamer-linux_x64",
    "commandWindows": "${NL_PATH}/streamer-win_x64.exe"
  }
]
```

With `enableExtensions: true`, Neutralino framework would automatically launch these extensions at startup by executing the specified commands.

## Goals / Non-Goals

**Goals:**
- Remove Neutralino's automatic extension launching mechanism from configuration
- Bundle extension binaries within Neutralino resources (.neu file) in `/resources/extensions/`
- Extract extension binaries at runtime to a writable location where they can be executed manually
- Maintain existing extension communication protocol (bootstrap via stdin, websocket, events)
- Support both Linux and Windows platform extensions
- Keep changes minimal and focused
- Ensure `nativeAllowList` includes necessary APIs for manual extension management (`resources.*`, `os.spawnProcess`, `os.execCommand`, `filesystem.chmod`, etc.)

**Non-Goals:**
- Changing the extension communication protocol
- Supporting additional extension types beyond streamer
- Modifying the build process for the extension itself (still built via Go)
- Changing how other Neutralino features work (filesystem, OS, etc.)

## Decisions

### Extension Storage Location
**Decision:** Store extension binaries in `/resources/extensions/` directory within the Neutralino resources.
**Rationale:** 
- Follows Neutralino convention for resource organization
- Keeps extensions separate from application code/resources
- Matches existing pattern used by other embedded resources
**Alternatives Considered:**
- `/resources/bin/`: Less clear about purpose
- Root of resources: Could cause naming conflicts

### Extraction Timing
**Decision:** Extract extensions during application startup, before Neutralino initialization and before attempting to connect to the streamer.
**Rationale:** 
- Ensures extensions are available when Neutralino framework tries to launch them (if keep enableExtensions: true)
- Guarantees extensions are ready before any extension-dependent code runs
- Simple to implement in startup sequence
**Alternatives Considered:**
- Extract on first use: More complex, risk of race conditions
- Extract during build: Doesn't solve the bundling problem

### Launch Mechanism
**Decision:** Keep enableExtensions: true in neutralino.config.json but modify the command paths to point to extracted locations. Use Neutralino.os.getPath() to get a writable temp directory for extraction.
**Rationale:** 
- Minimal changes to existing Neutralino extension handling
- Leverages Neutralino's built-in extension lifecycle management
- No need to manually manage extension processes
**Alternatives Considered:**
- Set enableExtensions: false and manually spawn via Neutralino.os.spawnProcess: Would require reimplementing extension lifecycle management
- Extract to fixed location like `/tmp/`: Less portable, permission concerns

### Resource Paths
**Decision:** Use Neutralino.resources.getFilesystem() to access bundled resources and extractFile() to extract extension binaries.
**Rationale:** 
- Uses official Neutralino resource API
- Handles both packed (.neu) and unpacked resource scenarios
- Provides async/await compatible interface
**Alternatives Considered:**
- Assume filesystem layout: Doesn't work when resources are packed

## Risks / Trade-offs

[Risk] Extraction adds slight startup delay → Mitigation: Extract asynchronously during startup, cache extracted files to avoid re-extraction on subsequent runs

[Risk] Temporary files accumulation → Mitigation: Extract to Neutralino-provided temporary directory, document that cleanup happens on app exit

[Risk] Platform-specific binary selection → Mitigation: Use Neutralino.os.getOS() to determine which binary to extract

[Risk] Extraction failures → Mitigation: Fallback to original behavior if extraction fails, log appropriate errors

## Migration Plan

1. Update build process to copy extension binaries to `/resources/extensions/` during packaging
2. Modify neutralino.config.json to reference extracted paths (will be updated at runtime)
3. Add resource extraction logic in neutralinoClient.startNeutralino() before Neutralino.init()
4. Test extraction and execution workflow
5. Verify extension communication still works as expected

## Open Questions

None - all technical decisions can be made based on current Neutralino API documentation and existing extension implementation.