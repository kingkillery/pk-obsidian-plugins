# InsForge Obsidian Plugin

This package turns InsForge workflows into an Obsidian community plugin.

## What it includes

- `Open InsForge dashboard` command and ribbon action
- `Test InsForge connection` command (`GET /api/health`)
- `Insert InsForge health-check block` editor command
- `Copy InsForge MCP config JSON` command
- Settings tab for base URL, dashboard URL, and optional API token

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Install in a vault

1. Build this package.
2. Copy `manifest.json`, `main.js`, and `styles.css` into:
   `.obsidian/plugins/insforge/`
3. Reload Obsidian and enable **InsForge** in Community Plugins.
