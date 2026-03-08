# NotebookLM CLI Resource Hub

## Status

The cloned project at `tools/notebooklm-cli` is deprecated upstream and points to `notebooklm-mcp-cli` as the newer combined CLI and MCP package.

## Demo video

- NotebookLM CLI overview: https://youtu.be/XyXVuALWZkE
- YouTube thumbnail used by the upstream README: https://img.youtube.com/vi/XyXVuALWZkE/maxresdefault.jpg?v=2

## Local downloaded assets

- CLI repo clone: `C:\Users\prest\OneDrive\Desktop\Desktop-Projects\Obsidian Plugins\tools\notebooklm-cli`
- local CLI launcher: `C:\Users\prest\OneDrive\Desktop\Desktop-Projects\Obsidian Plugins\tools\notebooklm-cli\.venv\Scripts\nlm.exe`
- logo image: `C:\Users\prest\OneDrive\Desktop\Desktop-Projects\Obsidian Plugins\tools\notebooklm-cli\assets\logo.jpeg`
- packaged AI skill zip: `C:\Users\prest\OneDrive\Desktop\Desktop-Projects\Obsidian Plugins\tools\notebooklm-cli\assets\nlm-cli-skill.zip`

## Local docs

- troubleshooting: `tools/notebooklm-cli/docs/TROUBLESHOOTING.md`
- CLI test plan: `tools/notebooklm-cli/docs/CLI_TEST_PLAN.md`
- technical deep dive: `tools/notebooklm-cli/docs/TECHNICAL_DEEP_DIVE.md`
- bundled skill: `tools/notebooklm-cli/nlm-cli-skill/SKILL.md`

## What the CLI can generate

- reports
- quizzes
- flashcards
- mind maps
- slides
- infographics
- videos
- data tables
- audio overviews

## Recommended first commands

```bash
nlm login
nlm auth status
nlm notebook create "How To Learn - Active Study"
nlm source add <notebook-id> --text "Your notes here" --title "Working Notes"
nlm quiz create <notebook-id> --confirm
nlm flashcards create <notebook-id> --confirm
nlm report create <notebook-id> --confirm
nlm --ai
```

## Suggested use inside Optimized Learning

1. Seed the learning resource pack.
2. Open `how-to-learn-with-notebooklm.md`.
3. Create a study session note.
4. Run `Capture NotebookLM AI reference`.
5. Use NotebookLM outputs to build retrieval practice instead of passive summaries.
