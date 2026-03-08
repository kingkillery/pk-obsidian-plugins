# Optimized Learning

`optimized-learning` is an Obsidian desktop plugin for building NotebookLM-centered learning systems.

Current focus:

- seed a reusable learning-resource pack into your vault
- create study-session notes from a template
- validate a local `nlm` install
- capture `nlm --ai` output into an Obsidian note for future agent workflows
- create a fallback intake note for a shared NotebookLM notebook when direct CLI access is blocked

## Local NotebookLM CLI

This repo installs the requested CLI at:

`C:\Users\prest\OneDrive\Desktop\Desktop-Projects\Obsidian Plugins\tools\notebooklm-cli\.venv\Scripts\nlm.exe`

The plugin defaults to that path, but you can change it in settings.

## Commands

- `Optimized Learning: Seed learning resource pack`
- `Optimized Learning: Create study session note`
- `Optimized Learning: Check NotebookLM CLI`
- `Optimized Learning: Capture NotebookLM AI reference`
- `Optimized Learning: Create shared NotebookLM intake note`

## Resource pack

The plugin seeds notes under the configured resource folder. The starter pack is aimed at learning how to learn with NotebookLM, not at a subject-matter curriculum yet.
