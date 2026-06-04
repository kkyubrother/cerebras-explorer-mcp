# Tasks: log and benchmark provenance for execution records (spec 022)

- [x] T001 Add a memoized execution-provenance helper that derives package/server version, compact schema version `2`, git SHA, ordered public tool names, exposed tool count, and tool-registry hash without adding dependencies.
- [x] T002 Thread optional provenance into transcript metadata records while preserving existing redaction and raw-mode behavior.
- [x] T003 Add run-level provenance to benchmark JSON reports while keeping `cases[].result` as the existing parent-facing result payload.
- [x] T004 Add focused tests for provenance helper shape, transcript metadata recording, and benchmark report output.
- [x] T005 Update README/DESIGN to document provenance as log/benchmark metadata only.
- [x] T006 Verify with `npm test` 414/0 and zero-dependency checks before landing.
