# llm-blocks conflict report

Canonical source selected: Solana-Grow\Solgrow\.obsidian\plugins\llm-blocks (used for centralized copy)
Copied to:
- plugins-obsidian\llm-blocks
- C:\ProgramData\ObsidianPlugins\llm-blocks

Sources detected:
- Obsidian Vault\.obsidian\plugins\llm-blocks
- Solana-Grow\Solgrow\.obsidian\plugins\llm-blocks

Conflict summary: 6 files differ between the two sources.

Conflicting items:
- .obsidian\app.json (missing in Solana-Grow, present in Obsidian Vault source)
- .obsidian\appearance.json (missing in Solana-Grow, present in Obsidian Vault source)
- .obsidian\core-plugins.json (missing in Solana-Grow, present in Obsidian Vault source)
- .obsidian\workspace.json (missing in Solana-Grow, present in Obsidian Vault source)
- data.json (different in both sources)
- Video Tools.md (missing in Solana-Grow, present in Obsidian Vault source)

Recommendation:
- Keep the clean `Solana-Grow` source as shared deployment baseline.
- `.obsidian` files and `Video Tools.md` in the Obsidian Vault source appear to be vault-local leftovers, not plugin runtime assets.
