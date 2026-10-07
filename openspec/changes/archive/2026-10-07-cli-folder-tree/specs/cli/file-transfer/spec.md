# Spec Delta

## ADDED Requirements

### Requirement: Finalize preserves relative meta.name path
When a receive completes successfully, the CLI SHALL place the final file under the configured download directory using the announced `meta.name` relative path (forward slashes mapped to the local filesystem), creating any missing parent directories. Path segments MUST reject parent-directory traversal (`..`). On name collision under that relative path, the CLI SHALL choose a unique available leaf name while keeping the same parent directory. Incomplete `.drop` partials remain flat basenames in the download directory root as today.

#### Scenario: Nested announce name creates parent dirs
- **WHEN** a receive completes for a file announced as `photos/nested/a.jpg`
- **THEN** the final file exists at `<download-dir>/photos/nested/a.jpg` (or a unique collision-safe leaf under `photos/nested/`)
- **AND** parent directories `photos` and `photos/nested` exist under the download directory

#### Scenario: Traversal segments rejected
- **WHEN** a receive would finalize with an announced name containing a `..` path segment
- **THEN** the CLI rejects that path and MUST NOT write outside the download directory via path traversal
