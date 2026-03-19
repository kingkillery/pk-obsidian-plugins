# Symphony

Symphony is an Obsidian desktop plugin for vault-driven issue orchestration.

The plugin now implements a working local runtime:

- can fall back to a local Symphony project checkout for `WORKFLOW.md`
- loads `WORKFLOW.md` with YAML front matter
- indexes Markdown issues under the configured vault folder
- resolves deterministic per-issue external workspaces
- launches `codex exec` runs in those workspaces
- tracks active runs, retries, and recent errors in a dashboard view
- refreshes on vault changes and fixed polling intervals
- keeps workspaces and logs outside the vault by default

## What it expects

By default Symphony reads:

- `symphony/WORKFLOW.md`
- `symphony/issues/*.md`

If the vault does not contain `symphony/WORKFLOW.md`, set `Symphony project root` in plugin settings to a local checkout such as `C:\code\Symphony-PM\symphony`. The plugin will fall back to `<project-root>/elixir/WORKFLOW.md`, seed new workspaces from that checkout, and strip `git clone ...` bootstrap lines from `after_create` so the remaining local setup can still run.

Issue notes need front matter like:

```md
---
id: issue_01
identifier: ABC-123
title: Implement OAuth login
state: Todo
priority: 2
labels:
  - auth
---

Implement OAuth login for the main app.
```

`WORKFLOW.md` can include front matter such as:

```md
---
vault:
  issues_path: symphony/issues
  active_states: [Todo, In Progress]
  terminal_states: [Done, Closed, Cancelled]
polling:
  interval_ms: 30000
workspace:
  root: $SYMPHONY_WORKSPACES
agent:
  max_concurrent_agents: 3
codex:
  command: codex exec
  approval_policy: never
  turn_sandbox_policy: workspace-write
---

Work on issue {{issue.identifier}}: {{issue.title}}

Issue description:
{{issue.description}}
```

## Runtime model

- The dashboard is the main observability surface.
- `Run current issue` dispatches the active issue note immediately.
- `Stop current issue` stops an active run or clears a queued retry.
- Successful runs mark the current issue revision as handled so unchanged active issues are not re-dispatched repeatedly.
- Failed runs back off exponentially and stay visible in the retry queue.

## Safety notes

- Symphony is desktop-only.
- Agent workspaces and logs are external filesystem paths, not vault paths.
- The plugin does not require direct vault mutation for normal execution.
- External process execution and network use depend on the configured Codex CLI environment.

`SPEC.md` remains the broader product specification. The plugin implementation in this repo is the practical Obsidian MVP around that contract.
