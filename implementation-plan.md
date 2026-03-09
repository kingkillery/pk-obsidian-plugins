# Symphony Obsidian Plugin Full Implementation Plan

Status: Partially implemented as of 2026-03-05
Project: Symphony (`plugins/symphony-main`)
Goal: Ship Symphony as a dependable Obsidian desktop plugin that hosts and supervises the existing Elixir orchestration sidecar.

## Current state

Symphony is no longer just a service spec. The repo now contains a real Obsidian plugin host with:

- desktop-only manifest and build scaffold
- settings tab and command palette controls
- sidecar process manager with startup, stop, restart, backoff, log buffering, and snapshot polling
- status bar and modal-based runtime view
- updated plugin-hosted `SPEC.md`
- `.planning/` knowledge base and `harness:check` script

This means the project is beyond planning and into implementation, but it is not yet fully complete.

## What is already done

### Plugin shell and lifecycle

- `manifest.json` marks the plugin as desktop-only.
- `src/main.ts` registers core commands for start, stop, restart, reload workflow, open status, open logs, and force snapshot.
- plugin load/unload wires service startup, shutdown, and periodic health refresh.

### Settings and runtime model

- `src/types.ts` defines plugin settings, service control contract, runtime state, event types, and snapshot types.
- `src/settings.ts` exposes repository path, workflow path, daemon path, observability, runtime overrides, and startup controls.

### Sidecar process supervision

- `src/services/symphony-service-manager.ts` resolves launch targets, builds runtime args, spawns the sidecar, tails logs, redacts secrets, restarts on failure, polls snapshot state, and normalizes API responses.

### Operator UI

- `src/ui/symphony-status-modal.ts` shows runtime status, active runs, retry queue, and recent logs.
- status bar reflects current service state and counts.

### Spec and harness groundwork

- `README.md` and `SPEC.md` now describe the plugin-hosted architecture.
- `.planning/PLANS.md`, `.planning/codebase/KNOWN_GAPS.md`, `.planning/quality/OPERATIONS_CHECKLIST.md`, and `.planning/quality/TESTING_AND_VERIFICATION.md` establish local engineering guidance.
- `scripts/harness-check.mjs` enforces required files, commands, and spec sections.

## What is not finished yet

### 1. Issue-level control is still incomplete

The plugin contract includes issue-level actions, but the current implementation does not truly support them:

- `terminateIssue()` explicitly returns an unsupported error
- `retryIssue()` does not perform a real retry action and falls back to workflow reload

This is the biggest functional gap between the spec and the implementation.

### 2. Workflow auto-reload is not fully implemented

The setting `autoReloadWorkflowOnChange` exists, but there is no true file watcher in the plugin layer. Right now workflow refresh only happens when manually triggered or when restart fallback is used.

### 3. Log viewer and status view are still merged

The plugin registers both “Open Symphony status” and “Open Symphony log viewer,” but both currently open the same modal. This is acceptable for v1, but it is not the richer UI described in the broader plan.

### 4. Plugin-level testing is thin

The repo has harness validation and Elixir tests, but the TypeScript plugin layer still lacks focused tests for:

- settings migration/default coercion
- service-manager parsing behavior
- command wiring and control actions
- snapshot normalization and API drift handling

### 5. Sidecar discovery and startup remain heuristic-based

Path resolution is useful but still somewhat fragile. The plugin tries explicit daemon path first, then packaged sidecar paths, then `mix exec`. This should be hardened and tested more directly across Windows, macOS, and Linux.

### 6. Release readiness is not yet proven

The codebase has the right scaffolding for release, but it has not yet cleared the stronger acceptance bar for a “fully implemented” plugin.

## Full work plan

## Phase 1: Close core contract gaps

Purpose: make the current feature set honest, reliable, and aligned with the spec.

Tasks:

- Decide whether issue-level terminate/retry is truly in v1 scope.
- If yes, extend the sidecar API and plugin manager to support real terminate and retry endpoints.
- If no, tighten the spec and UI wording so unsupported actions are clearly marked as deferred.
- Add explicit UI messaging for unsupported operations so they are visible and unsurprising.
- Make command behavior and status feedback consistent across command palette, settings buttons, and modal controls.

Exit criteria:

- no misleading controls
- issue action behavior matches the documented v1 contract
- unsupported actions are either implemented or clearly deferred everywhere

## Phase 2: Implement workflow change watching

Purpose: make the plugin behave like a host-managed desktop tool instead of a mostly manual wrapper.

Tasks:

- add filesystem watching for `WORKFLOW.md`
- debounce change handling so repeated file writes do not thrash the sidecar
- when enabled, call refresh endpoint first
- if refresh endpoint is unavailable or fails, fall back to controlled restart
- surface workflow reload activity in logs and status UI

Exit criteria:

- workflow file changes trigger predictable refresh behavior
- no duplicate restart storms
- operator can tell when reload succeeded or fell back to restart

## Phase 3: Improve operator UI and observability

Purpose: make runtime behavior easier to understand and safer to operate.

Tasks:

- split status and logs into clearer UI surfaces, or make the current modal intentionally multi-pane
- add basic filtering and sorting for active runs and retry queue
- show last snapshot age and API availability explicitly
- make retry queue timing easier to scan
- show lifecycle events and last failure in a more durable way
- consider adding an optional dedicated side panel or leaf view if Obsidian UX supports it cleanly

Exit criteria:

- operators can quickly answer: is Symphony running, what is active, what is stuck, and what failed?
- log view is usable without reading raw mixed output

## Phase 4: Harden process and platform behavior

Purpose: reduce startup and runtime surprises across environments.

Tasks:

- harden daemon path discovery and startup diagnostics
- improve Windows-specific process handling and shutdown behavior
- confirm repository path and workflow path validation are explicit and user-friendly
- ensure secret redaction covers all sensitive env-backed values used in practice
- add stale-process detection and more explicit recovery messages
- document exact supported launch patterns for packaged sidecar, `mix`, and custom launcher modes

Exit criteria:

- startup failures are understandable
- restart behavior is predictable
- platform-specific caveats are documented and tested

## Phase 5: Add plugin-layer tests and stronger harness checks

Purpose: move from “implemented” to “defensible.”

Tasks:

- add TypeScript tests for settings defaults and migration behavior
- add tests for log/event parsing and snapshot normalization
- add tests for health and refresh failure handling
- add tests for daemon path resolution
- expand harness checks to cover more command-to-implementation parity and expected settings fields
- add API payload fixture tests for `/api/v1/state` and `/api/v1/refresh`

Exit criteria:

- plugin-layer behavior has focused automated coverage
- common regressions can be caught before release

## Phase 6: Final release preparation

Purpose: make the plugin actually ready for other people to use.

Tasks:

- validate all documented commands manually in Obsidian desktop
- verify plugin unload/disable stops sidecar cleanly
- verify startup with valid and invalid workflow paths
- verify observability enabled vs disabled modes
- update README with exact install and troubleshooting steps
- add a concise release checklist and known limitations section for users

Exit criteria:

- release workflow is documented
- operational caveats are honest
- plugin can be enabled and used without insider knowledge

## Recommended implementation order

1. Close the issue-action contract gap.
2. Add workflow file watching and controlled reload behavior.
3. Improve status and log UX.
4. Add plugin-layer tests and stronger API contract validation.
5. Do final release hardening and documentation pass.

This order matters because it resolves the biggest trust issues first: operator controls, workflow refresh behavior, and confidence in runtime state.

## Decisions needed

### Decision 1: Are issue terminate/retry actions true v1 requirements?

Options:

- Keep them in v1 and implement sidecar endpoints now.
- Mark them as v1 deferred and simplify the UI.

Recommendation:

- If Symphony is meant for real operator use soon, implement them.
- If the goal is a stable first desktop wrapper quickly, defer them but make the UI honest.

### Decision 2: Is the current modal-only UI enough for v1?

Options:

- Keep status + logs together in one modal.
- Split logs into a separate view or panel.

Recommendation:

- Keep modal-first for v1 unless active usage is already exposing real usability pain.

### Decision 3: How much platform support is required before release?

Options:

- Windows-first release with Linux/macOS best-effort
- cross-platform release gate

Recommendation:

- Treat Windows as the required release target right now, because that is the environment already reflected in current paths and setup.

## Acceptance criteria for “fully implemented”

Symphony should only be called fully implemented when all of the following are true:

- plugin commands behave as documented
- unsupported issue actions are either implemented or removed from the active UX contract
- workflow file changes can be handled without manual restart in the normal case
- status and logs give enough visibility to operate multiple runs safely
- plugin settings and runtime parsing have automated coverage
- README, SPEC, and `.planning/` docs match reality
- plugin unload/disable cleans up the sidecar reliably

## Immediate next move

Best next step:

Implement either:

1. real issue terminate/retry support in the sidecar contract
or
2. workflow file watching with controlled refresh/restart fallback

If the goal is trust and correctness, issue-action truthfulness is the first priority.
If the goal is day-to-day usability, workflow watching is the first priority.

## Reference basis

This plan is based on the current implementation and project planning documents:

- `plugins/symphony-main/README.md`
- `plugins/symphony-main/SPEC.md`
- `plugins/symphony-main/.planning/PLANS.md`
- `plugins/symphony-main/.planning/codebase/KNOWN_GAPS.md`
- `plugins/symphony-main/.planning/quality/OPERATIONS_CHECKLIST.md`
- `plugins/symphony-main/.planning/quality/TESTING_AND_VERIFICATION.md`
- `plugins/symphony-main/src/main.ts`
- `plugins/symphony-main/src/settings.ts`
- `plugins/symphony-main/src/types.ts`
- `plugins/symphony-main/src/services/symphony-service-manager.ts`
- `plugins/symphony-main/src/ui/symphony-status-modal.ts`