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
