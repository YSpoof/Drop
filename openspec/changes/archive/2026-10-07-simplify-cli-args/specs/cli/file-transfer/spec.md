# Spec Delta

## MODIFIED Requirements

### Requirement: Relative path in outbound meta name
When announcing a file that belongs to a watched folder (or any send rooted at a directory tree), the sender SHALL set `meta.name` to a Drop-compatible relative path using forward slashes, including the watched folder’s basename as the first path segment (e.g. watching `/tmp/photos` yields `photos/a.jpg`, not `a.jpg`). Single-file or multi-file positional sends (regular files, not a watched directory) MAY keep a basename-only `name`. The Drop identity `hash` SHALL be computed from that same `name` string plus size and mtime.

#### Scenario: Watched file announces relative path
- **WHEN** the CLI watches directory `/data/project` and a new file `/data/project/src/main.go` is queued for send
- **THEN** the outbound `meta` message uses `name` equal to `project/src/main.go` (forward slashes)
- **AND** `hash` equals `fileIdentity("project/src/main.go", size, mtimeMs)`

#### Scenario: Single-file send keeps basename
- **WHEN** the CLI sends with positional path `/tmp/report.pdf`
- **THEN** the outbound `meta.name` is `report.pdf`
