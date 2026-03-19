# Obsidian Multimodal Retrieval

This workspace implements an Obsidian-first multimodal retrieval system with:

- a thin Obsidian plugin
- a local index-service sidecar
- Gemini embeddings for vault content
- hybrid retrieval and reranking scaffolding
- evals gated by ACA-style validation

## Current vertical slice

The index service can now:

- discover every Obsidian vault under this workspace by finding `.obsidian` roots
- ignore recursive plugin copies nested under `.obsidian/plugins`
- chunk Markdown-like files (`.md`, `.markdown`, `.txt`, `.canvas`)
- embed every chunk with Gemini using `models/gemini-embedding-001`
- persist a rebuildable local index
- run semantic search over the embedded corpus

## Environment

Set one of these before indexing:

- `GEMINI_API_KEY`
- `GOOGLE_API_KEY`

Optional overrides:

- `OBSIDIAN_VAULT_SCAN_ROOT`
- `INDEX_SERVICE_DATA_DIR`
- `GEMINI_EMBED_MODEL`
- `MAX_EMBED_FILE_BYTES`

## Commands

Discover vaults:

```powershell
node apps/index-service/src/server.js --discover-vaults
```

Index all discovered vaults:

```powershell
node apps/index-service/src/server.js --index-all
```

CLI access through `pk-qmd`:

```powershell
node bin/pk-qmd.mjs discover
node bin/pk-qmd.mjs index
node bin/pk-qmd.mjs search "task management calendar pomodoro" --top-k 3
node bin/pk-qmd.mjs serve --port 4317
```

Windows repo-local wrapper:

```powershell
.\bin\pk-qmd.cmd discover
.\bin\pk-qmd.cmd index
.\bin\pk-qmd.cmd search "task management calendar pomodoro" --top-k 3
```

If this package is linked or installed globally, the same commands are available as:

```powershell
pk-qmd discover
pk-qmd index
pk-qmd search "task management calendar pomodoro" --top-k 3
pk-qmd serve --port 4317
```

To make `pk-qmd` available as a normal command on this machine:

```powershell
npm link
pk-qmd discover
```

To remove the global link later:

```powershell
npm unlink -g obsidian-multimodal-retrieval
```

## Packaging and install on other machines

Create a publish-ready tarball locally:

```powershell
npm run publish:dry-run
npm run pack:cli
```

That produces a file like:

```powershell
pk-qmd-0.1.0.tgz
```

Install that tarball on another machine without cloning the repo:

```powershell
npm install -g .\pk-qmd-0.1.0.tgz
pk-qmd status
```

Once you are ready to publish to npm itself:

```powershell
npm login
npm publish
```

Current package name reserved in this repo:

`pk-qmd`

Note:

- the package is configured as `UNLICENSED` right now, so choose a real license before a public npm release if that is your intent
- `GEMINI_API_KEY` or `GOOGLE_API_KEY` must be present on the target machine for indexing and semantic search

Start the service:

```powershell
node apps/index-service/src/server.js
```

Then call:

- `GET /vaults/discover`
- `POST /index/all`
- `GET /index/status`
- `POST /search`

## Initial build order

1. Markdown and PDF ingestion
2. Text and image embeddings
3. `/search` endpoint
4. Obsidian search pane
5. Lexical hybrid retrieval
6. Context-aware boosts
7. Transcript retrieval
8. Reranking
