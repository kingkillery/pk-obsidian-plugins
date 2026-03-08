# Plugin Consolidation Plan

## Current state

Active plugin roots under `plugins/`:

- `llm-blocks`
- `obsidian-codex-app`
- `obsidian-companion-main`
- `obsidian-excalidraw-plugin`
- `obsidian-importer`
- `obsidian-LocalMediaEmbedder-plugin`
- `obsidian-sheet-plus`
- `obsidian-tasks-plugin`
- `tasknotes`

Archived non-candidates under `plugins/archive/`:

- `obsidian-execute-code`
- `obsidian-plugins-docs`
- `obsidian-terminal`

These archived directories were moved, not deleted. They looked like placeholders or malformed vault snapshots rather than reviewable plugin source roots.

## Recommended tracks

### Track 1: Product merge

Merge `llm-blocks` and `obsidian-codex-app` into a single desktop plugin.

Target outcome:

- One Codex backend/session model
- One settings surface for Codex connection and auth
- Two UI surfaces:
  - embedded Codex pane
  - inline note tools such as `llm` blocks, chat, and canvas

Rationale:

- Both already center on Codex-specific workflows.
- `llm-blocks` owns note-native AI surfaces.
- `obsidian-codex-app` owns the embedded app host and sidecar lifecycle.

### Track 2: Shared AI core

Do not merge `obsidian-companion-main` into the product above yet.

Instead, extract or standardize shared AI plumbing across:

- `llm-blocks`
- `obsidian-companion-main`

Candidate shared pieces:

- provider/model definitions
- auth/config schema
- request adapters
- prompt/context normalization

Keep separate UX surfaces:

- `Companion` stays focused on autocomplete and slash commands
- Codex plugin stays focused on chat, blocks, canvas, and pane workflows

### Track 3: Task integrations

Do not merge `tasknotes` and `obsidian-tasks-plugin`.

Instead:

- treat `obsidian-tasks-plugin` as inline checklist storage
- treat `tasknotes` as note-per-task storage
- add explicit adapters in `llm-blocks` or the merged Codex plugin for both

Desired integration seams:

- checklist task enrichment for `Tasks`
- task promotion from checklist items into `TaskNotes`
- normalized status, priority, and date vocabulary across both models

## Non-targets

Leave these separate:

- `obsidian-excalidraw-plugin`
- `obsidian-importer`
- `obsidian-LocalMediaEmbedder-plugin`
- `obsidian-sheet-plus`

They solve distinct product problems and are not sensible consolidation targets for the AI/task stack.

## Execution order

1. Build a merged architecture spec for `llm-blocks` + `obsidian-codex-app`.
2. Decide the canonical backend contract:
   - WebSocket RPC
   - embedded UI bridge
   - auth/session lifecycle
3. Move Codex-pane hosting into the merged plugin shell.
4. Port `llm-blocks` commands and views onto the same backend/session.
5. Extract shared provider/model code that `Companion` can also consume later.
6. Add task adapters for `Tasks` and `TaskNotes`.
7. Only after the merged Codex plugin is stable, decide whether `Companion` should remain separate or be partially folded in.

## Archive rule

Nothing should be deleted during cleanup or consolidation.

If a directory stops being an active target, move it under a folder named `archive`.
