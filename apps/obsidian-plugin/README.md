# PK QMD Retrieval Plugin

This app is now a real Obsidian plugin shell for the local PK QMD sidecar.

## Current capabilities

- opens a dedicated retrieval pane inside Obsidian
- shows sidecar/index status
- discovers configured vaults from the local index service
- triggers `POST /index/all`
- runs `POST /search`
- uses the current note or current selection as a search query seed
- inserts staged search results into the active note instead of mutating notes automatically

## Files

- `manifest.json`: Obsidian plugin manifest
- `main.js`: plugin runtime, pane UI, commands, and settings
- `styles.css`: native-feeling Obsidian pane styling

## Commands exposed

- `Open retrieval pane`
- `Index all discovered vaults`
- `Search related content for current note`

## Runtime assumption

The plugin expects the local sidecar to be reachable at the configured base URL, defaulting to:

`http://127.0.0.1:4317`
