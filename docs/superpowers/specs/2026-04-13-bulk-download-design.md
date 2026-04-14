# Bulk Download Feature — Design Spec

## Context

Gong Explorer currently supports downloading individual call recordings (audio/video) one at a time from the call detail page. Users who need to export multiple recordings — e.g., all calls from a specific week for training review, or all calls from a particular team — must manually navigate to each call and download individually.

This feature adds bulk selection and batch download capability, letting users select specific calls (or all calls in a date range) and download their media files as a single ZIP archive.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ZIP assembly | Client-side (`fflate`) | Avoids Vercel serverless time limits; natural per-file progress tracking; no server memory pressure |
| Delivery | Single ZIP file | Clean single-file experience vs. browser-blocked sequential downloads |
| Media type selection | Per-batch toggle (Audio / Video / Both) | Simpler than per-call toggles; covers the common use case |
| "Select All" scope | All calls matching date range filter | Full power — not limited to loaded/visible calls |
| Progress UX | Modal with per-file progress + cancel | Users need visibility and control for large batch operations |

## Selection UI

### Selection Mode on Call List (`call-list.tsx`)

- A **"Select"** button added to the filter bar (next to "fetch")
- Toggling it on enters selection mode:
  - Each call card shows a **checkbox** on the left (before the media type icon)
  - Clicking a card **toggles selection** instead of navigating to the detail page
  - Clicking the card's checkbox also toggles selection
- Toggling selection mode off clears all selections

### Floating Action Bar (`bulk-download-bar.tsx`)

Appears fixed at the bottom of the viewport when 1+ calls are selected:

- **Selection count**: "12 calls selected"
- **"Select All (247)"** button: fetches all call IDs in the current date range via auto-pagination
- **Media type picker**: pill toggle — Audio | Video | Both (default: Both)
- **"Download ZIP"** button: gradient-styled, triggers the download pipeline
- **"Clear"** button: deselects all

### Selection State

- `selectedIds`: `Set<string>` — tracks which call IDs are selected
- `selectedCalls`: `Map<string, GongCall>` — stores full call objects for selected calls (needed for media URLs and title/date for filenames)

## "Select All" — Fetching All Calls

When the user clicks "Select All," the app needs media URLs for every call in the date range, not just those loaded on screen.

### Implementation (`use-gong-api.ts`)

- New function `fetchAllCalls(fromDate, toDate)` auto-paginates through the existing `/api/gong/calls` endpoint using cursor-based pagination
- Collects: call ID, title, date, audioUrl, videoUrl per call
- Pagination is sequential (cursor-dependent)
- Floating bar shows spinner: "Loading all calls..." during pagination
- Cancellable — if user cancels mid-pagination, keeps what was fetched so far

### Rate Limit Awareness

- If `rateLimitRemaining` drops below 100 during pagination, show a warning: "Low API quota — continue fetching?"
- Existing rate limit badge in the filter bar continues to update in real-time

## Download Engine (`use-bulk-download.ts`)

### Pipeline

1. User clicks "Download ZIP"
2. Progress modal opens
3. Iterate through selected calls, fetching media via existing `/api/gong/media` proxy
4. **Concurrency**: 3 files fetched in parallel (prevents overwhelming browser/server)
5. Each fetched file is added to ZIP via `fflate`
6. ZIP finalized and triggers browser download

### ZIP Structure

```
gong-export-2026-04-13/
  Call Title - 2026-04-10/
    call-title-2026-04-10.mp3
    call-title-2026-04-10.mp4
  Another Call - 2026-04-11/
    another-call-2026-04-11.mp3
    another-call-2026-04-11.mp4
```

- Each call gets its own folder
- Filenames sanitized from call title + date
- Duplicate names get numeric suffix (e.g., `call-title-2026-04-10-2.mp3`)

### Cancellation

- `AbortController` aborts all in-flight fetches
- Partial data discarded, modal closes

### Error Handling

- Failed individual files are skipped and logged
- Completion summary: "Downloaded 48/50 files. 2 failed." with details on which calls failed
- ZIP downloads with whatever succeeded

## Progress Modal (`bulk-download-modal.tsx`)

Full-screen overlay with glassmorphic card (matches existing design language):

- Current file indicator: "Downloading 12 of 50..."
- Progress bar (percentage based on file count)
- Files remaining count
- **Cancel** button — aborts all in-flight fetches
- On completion: summary with success/failure counts and download trigger

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `src/hooks/use-bulk-download.ts` | Download engine: fetch queue, ZIP assembly with `fflate`, progress state, cancellation |
| `src/components/bulk-download-bar.tsx` | Floating action bar: selection count, Select All, media type picker, Download ZIP, Clear |
| `src/components/bulk-download-modal.tsx` | Progress modal: progress bar, current file, cancel, completion summary |

### Modified Files

| File | Changes |
|------|---------|
| `src/components/call-list.tsx` | Selection mode toggle, checkbox on each card, selection state (`Set` + `Map`), render action bar and modal |
| `src/hooks/use-gong-api.ts` | Add `fetchAllCalls()` auto-pagination function |
| `package.json` | Add `fflate` dependency |

### Unchanged

- API routes (`/api/gong/media`, `/api/gong/calls`, `/api/gong/calls/[id]`) — existing proxy handles individual fetches
- `src/lib/gong-client.ts` — server-side logic unchanged
- `src/lib/types.ts` — existing types sufficient
- `src/components/ui/*` — reuse existing components

## Edge Cases

- **Calls with no video URL** when "Both" selected: download audio only, skip video, note in summary
- **Calls with no media at all**: skip entirely, note in summary
- **Empty selection**: Download ZIP button disabled
- **Rate limit during Select All**: warning prompt at < 100 remaining
- **Long call titles**: sanitize to filesystem-safe characters, truncate if needed
- **Duplicate filenames**: append numeric suffix

## Verification Plan

1. `npm run dev` — start dev server
2. Connect with Gong credentials, load calls
3. Click "Select" — verify checkboxes appear on cards
4. Select a few calls — verify floating bar with correct count
5. Toggle media type (Audio / Video / Both), click "Download ZIP"
6. Verify progress modal with per-file updates
7. Verify ZIP downloads with correct folder structure and playable files
8. Test "Select All" with small date range — verify pagination and full selection
9. Cancel mid-download — verify clean abort
10. Test call with missing video — verify graceful skip + summary report
