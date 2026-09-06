# pixi Memory & Data Storage Architecture

pixi Assistant implements a **100% local, multi-layered memory and session storage architecture**. All data remains strictly on the user's local machine—no cloud databases, vector embeddings, or external memory services are used.

---

## Architectural Overview

```
                      +-----------------------------------+
                      |         User Input / Turn         |
                      +-----------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
|                        Per-Turn Context Assembly                              |
|                                                                               |
|  1. Permanent Profile      --> memory/profile.md (ALWAYS Loaded)             |
|  2. Keyword Retrieval      --> memory/{preferences,routines,projects,people}  |
|  3. Session Summary        --> SQLite sessions.summary                        |
|  4. Recent Raw Messages    --> SQLite messages table (last 10 messages)        |
+-------------------------------------------------------------------------------+
                                        |
                                        v
                      +-----------------------------------+
                      |             LLM Turn              |
                      +-----------------------------------+
                                        |
                     +------------------+------------------+
                     |                                     |
                     v                                     v
   +------------------------------------+  +------------------------------------+
   | SQLite Message Buffer Log          |  | Non-Blocking Async Fact Extraction  |
   | (add user & assistant messages)    |  | (writes to Markdown memory files)  |
   +------------------------------------+  +------------------------------------+
                     |                                     |
                     v                                     v
   +------------------------------------+  +------------------------------------+
   | Rolling Summary & Prune Worker     |  | Mutex-Locked In-Place Edit/Dedup   |
   | (archives to .jsonl.gz, updates    |  | (updates frontmatter date, edits   |
   | summary, deletes raw SQLite rows)  |  | contradictory lines in place)      |
   +------------------------------------+  +------------------------------------+
```

---

## 1. SQLite Session & Message Storage (`assistant.db`)

Session history is managed locally in `assistant.db` using **better-sqlite3** and **Drizzle ORM**. Auto-migrations apply on database initialization.

### Schema Definition (`src/db/schema.ts`)

- **`sessions` table**:
  - `id`: Integer primary key (auto-increment).
  - `started_at`: ISO-8601 text timestamp (`YYYY-MM-DDTHH:mm:ss.sssZ`).
  - `ended_at`: Nullable ISO-8601 text timestamp.
  - `summary`: Nullable text containing accumulated session summary text.

- **`messages` table**:
  - `id`: Integer primary key (auto-increment).
  - `session_id`: Integer foreign key referencing `sessions.id`.
  - `role`: Text enum (`'user'` | `'assistant'` | `'system'`).
  - `content`: Message text string.
  - `created_at`: ISO-8601 text timestamp.
  - `token_count`: Nullable integer.
  - **Index**: `messages_session_id_idx` on `messages.session_id`.

The `messages` table functions as a high-speed, rolling buffer for recent turn history.

---

## 2. Rolling Summary & Flat File Archiving (`archive/sessions/`)

To prevent the SQLite database from growing unbounded while retaining total history, pixi uses a rolling summarization and gzip archiving worker (`src/memory/rolling-summary.ts`).

### Trigger Conditions
- Session hits message threshold (**>= 20 raw messages** in SQLite).
- Session remains idle for **5 minutes**.
- Renderer disconnect / app shutdown.

### Execution Flow
1. **Identification**: Takes raw messages older than the cutoff (preserving the ~10 most recent raw messages for live context).
2. **Archiving**: Formats pruned messages as JSON lines (`JSONL`) and appends/compresses them into flat gzip files:
   ```
   archive/sessions/{date}-session-{id}.jsonl.gz
   ```
3. **Summarization**: Calls a fast LLM completion to merge older messages into `sessions.summary`.
4. **Pruning**: Deletes the pruned raw rows from the SQLite `messages` table.

---

## 3. Long-Term Markdown Memory (`memory/`)

Long-term knowledge, identity, and user facts are stored in human-readable Markdown files inside the `./memory/` directory.

### Directory Layout
```
memory/
  ├── profile.md          # User identity, name, role (ALWAYS loaded into every context)
  ├── preferences.md      # Likes, dislikes, communication style
  ├── routines.md         # Recurring daily patterns & schedules
  ├── projects/           # Project-specific context files (e.g. projects/pixi.md)
  └── people/             # Information about specific individuals (e.g. people/john.md)
```

### File Format
Each Markdown memory file contains YAML frontmatter and a bullet list of facts:

```markdown
---
category: profile
updated: 2026-08-11
description: Identity facts about the user including name and core background
---
- Name: Kapil
- Assistant: pixi
```

### In-Memory Manifest & Keyword Retrieval
- **In-Memory Manifest**: pixi builds an in-memory index of all memory files (`relPath`, `category`, `description`, tokenized `keywords`). The manifest is refreshed on application startup and after any file write.
- **Retrieval Algorithm**:
  1. `profile.md` is **ALWAYS** loaded into every prompt context build (no exceptions).
  2. For all other memory files, non-stop-word keyword overlap is calculated between the current user prompt and file manifest metadata.
  3. Matching files are read in full and injected into the turn's prompt context.

---

## 4. Async Fact Extraction & Contradiction Resolution

Fact extraction (`src/memory/fact-extractor.ts`) runs as an **asynchronous, non-blocking background task** after each turn response is dispatched, adding zero latency to live conversation.

### Structured Extraction Rules
1. **JSON Output**: Returns an array of objects: `{ fact, category, target_file, confidence }`.
2. **Identity Prioritization**: Name, job title, and core identity facts are routed straight to `profile.md`.
3. **Safety Exclusions**: Health, medical, financial, credit card, password, or relationship details are **STRICTLY EXCLUDED** unless the user explicitly commands pixi to remember/note them down.
4. **Contradiction & In-Place Editing**: Before writing, the worker checks target file contents. If a new fact contradicts an existing bullet point (e.g., "vegetarian" vs "eats chicken now"), it edits the line in-place:
   ```markdown
   - Eats chicken now (previously: vegetarian)
   ```
5. **Mutex Write Serialization**: An asynchronous Mutex lock (`memoryWriteMutex`) serializes file updates to prevent concurrent write collisions.

---

## 5. Per-Turn Context Assembly Pipeline

For every live user turn, `src/memory/context-pipeline.ts` assembles context in the following sequence:

1. **Load `profile.md`**: Injected into every turn prompt without exception.
2. **Keyword Overlap Retrieval**: Scans the user prompt against the memory manifest and appends matching memory files.
3. **Session Summary**: Loads `sessions.summary` from SQLite if available.
4. **Recent History**: Retrieves the most recent ~10 raw messages from SQLite.
5. **Prompt Injection**: Combines persona guidelines + profile + relevant memory files + session summary + recent history into the system prompt passed to the LLM.
6. **Post-Turn Async Processing**: Dispatches non-blocking fact extraction and rolling summary checks.
