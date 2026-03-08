# NLM CLI Cheatsheet

## Authentication

```bash
nlm login
nlm auth status
```

## Notebook setup

```bash
nlm notebook create "How To Learn - Active Study"
nlm notebook list
nlm notebook get <notebook-id>
```

## Add sources

```bash
nlm source add <notebook-id> --url "https://example.com/article"
nlm source add <notebook-id> --text "Your notes here" --title "Working Notes"
nlm source list <notebook-id>
```

## Generate study assets

```bash
nlm report create <notebook-id> --confirm
nlm quiz create <notebook-id> --confirm
nlm flashcards create <notebook-id> --confirm
nlm audio create <notebook-id> --confirm
```

## Teach an AI tool how to use the CLI

```bash
nlm --ai
```
