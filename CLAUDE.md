# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
npm run dev          # Development mode (electron-vite dev, hot reload)
npm run build        # Production build (electron-vite build)
npm run build:mac    # macOS app build with signing (electron-builder)
npm run start        # Preview production build (electron-vite preview)
```

No test suite exists. Verify changes by building (`npm run build`) and running (`npm run dev`).

## Architecture

**Stash** is a macOS Electron app that indexes iMessage attachments and message text from Apple's `chat.db`, providing relationship insights, conversation analytics, and a searchable archive.

### Three-Process Electron Architecture

- **Main process** (`src/main/`) — Node.js. Database, file system, IPC handlers, Swift helper compilation, tray icon, menu bar.
- **Renderer** (`src/renderer/src/`) — React 18 + Tailwind CSS. Single-page app with inline styles for card components.
- **Preload** (`src/preload/index.ts`) — Context bridge exposing `window.api` with typed IPC methods. The `StashAPI` type is exported from here.

All renderer↔main communication goes through `window.api.*` → `ipcRenderer.invoke()` → `ipcMain.handle()`. There are ~40 IPC handlers.

### Database Layer (`src/main/db.ts`)

Two SQLite databases:
- **stash.db** (`~/Library/Application Support/Stash/stash.db`) — App's own database. `better-sqlite3` in WAL mode. Contains `attachments` table + `attachments_fts` (FTS5), `messages` table + `messages_fts` (FTS5), `hidden_chats`.
- **chat.db** (`~/Library/Messages/chat.db`) — Apple's Messages database, opened readonly for enrichment queries (message counts, laugh detection, reaction counts, group detection, reply latency, late-night ratio, peak hour/weekday).

**Two-phase stats loading:**
- `getFastStats()` — queries stash.db only (~100ms). Returns attachment counts and conversation list with zeroed enrichment fields.
- `getStats()` — queries both databases (~2min cold due to laugh detection full-table scan). Returns enriched data with message counts, laughs, late-night ratio, reply latency, group detection via `chat_handle_join`.

Caches (`laughCache`, `lateNightCache`, `replyLatencyCache`) are module-level Maps invalidated per session via `invalidateLaughCache()`.

### Indexing Pipeline (`src/main/indexer.ts`)

Multi-phase async pipeline:
1. Metadata-only insert for all selected attachments
2-5. Documents → Recent images → Older images → Videos/audio (thumbnails via `sharp`, OCR via Swift helper)
6. Message text indexing into `messages` + `messages_fts` (batched, incremental by `apple_date`)

Progress reported to renderer via `indexing-progress` IPC event. `powerSaveBlocker` active during indexing.

### Swift Helpers (`src/main/*.swift`)

Compiled at runtime via `swiftc` (mtime check, once per session):
- `contacts.swift` — CNContactStore batch name resolution
- `ocr.swift` — Vision framework text extraction
- `icloud.swift` — brctl-based iCloud file recovery

### App Navigation (`src/renderer/src/App.tsx`)

`MainView` discriminated union drives all routing:
```typescript
type MainView =
  | { kind: 'global-insights' }
  | { kind: 'global-attachments' }
  | { kind: 'person-insights'; person: string }
  | { kind: 'person-attachments'; person: string }
```

Four insight surfaces controlled by `insightSurface` state: `'relationship' | 'personal' | 'usage' | 'conversational'`.

### Dashboard (`src/renderer/src/components/Dashboard.tsx`)

~1500 lines. Contains all card archetype components inline (PosterCard, SplitCard, WinnerCard, EditorialCard, BandCard, SpectrumCard, LeaderboardCard, LoquaciousnessCard, ConstellationCard, TodayInHistoryCard, WarmingCard, DrillThroughPanel) plus the Dashboard function with four surface renderers.

**Critical pattern:** All `useState`/`useEffect` hooks must appear before the `if (scopedPerson) { return ... }` early return. Hooks after that line cause React violations and black screens.

## Key Patterns

### Apple Timestamps
Apple Messages uses nanosecond timestamps with epoch 2001-01-01:
```
unix_seconds = apple_nanoseconds / 1000000000 + 978307200
```

### Group Chat Detection
Uses `chat_handle_join` participant count per `chat.ROWID`, rolled up to `chat_identifier`. `chat.style` values are unreliable — participant count is the sole signal.

### Contact Resolution
Batch resolution via Swift helper (`resolveContactsBatch`). Results cached in module-level `contactCache` Map. Phone numbers and emails resolved through CNContactStore.

### Date Range
`dateRangeToBounds()` in App.tsx handles presets (`'7days'`, `'30days'`, `'month'`, `'year'`) plus year strings (`'2024'`) and month strings (`'2024-03'`) with proper from/to ISO bounds.

### Design System
- Canvas: `#F2EDE8` (warm off-white)
- Coral: `#E8604A` (you/primary)
- Teal: `#2EC4A0` (them/relationship)
- Purple: `#7F77DD` (usage)
- Warm dark: `#26211d` (hero backgrounds)
- Fonts: Unbounded (display, weight 200), DM Sans (UI)

## Adding New IPC Endpoints

1. Add function to `src/main/db.ts` (or relevant main module)
2. Add `ipcMain.handle('handler-name', ...)` in `src/main/index.ts`
3. Add typed method to `window.api` object in `src/preload/index.ts`
4. Call via `window.api.methodName()` in renderer

The preload `StashAPI` type is inferred from the `api` object — no separate type file needed.

## Gotchas

- **HEIC images** — Browsers can't render HEIC. Converted on-demand via macOS `sips` to JPEG with caching.
- **File URLs blocked** — Electron CSP blocks `file://` in dev mode. All images served as base64 data URLs via `get-file-url` IPC.
- **chat.db backfill** — 4947 records have null `chat_name` in stash.db. Backfill runs on `initDb()` by mapping attachment paths through chat.db joins.
- **Laugh detection performance** — Full-table scan with window functions. SQL pre-filter on laugh keywords reduces scan from all messages to ~10% of rows.
- **Reply latency** — Single CTE query with window functions, not per-chat loop.
