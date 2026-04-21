# Salesloft Export — Design

**Status:** Approved for implementation planning
**Date:** 2026-04-21
**Related:** `2026-04-13-bulk-download-design.md`

## Context

The bulk download feature currently only exports Gong calls. Salesloft users hit a hard-coded rejection ("Export is only supported for Gong right now" — `src/hooks/use-bulk-download.ts:71`, `src/app/api/gong/export/route.ts:24-25,113-114`). Goal: full feature parity — a Salesloft user selecting calls and clicking Download should get the same zip layout, same metadata, same transcript, same recording as a Gong user.

## Architecture

A provider-agnostic export endpoint that dispatches through a thin adapter per provider. The existing zip-streaming plumbing, manifest rendering, folder-naming, and rate-limit logic stay put and are reused.

**New files**
- `src/app/api/export/route.ts` — single entry point for bulk export.
- `src/lib/export/adapters/gong.ts` — Gong implementation of the adapter.
- `src/lib/export/adapters/salesloft.ts` — Salesloft implementation.
- `src/lib/export/adapters/index.ts` — `selectAdapter(provider)` dispatcher.

**Modified files**
- `src/lib/export/zip-stream.ts` — consumes `ExportAdapter` instead of calling `gong-client` directly.
- `src/lib/salesloft-client.ts` — add `fetchTranscriptionSentences(creds, transcriptionId)`.
- `src/hooks/use-bulk-download.ts` — remove Gong-only short-circuit (lines 60-75).
- `src/hooks/use-export.ts` — POST to `/api/export` instead of `/api/gong/export`.
- `src/lib/types.ts` — extend `SalesLoftConversation` with `transcription_id?: string` and optional `action_items`, `key_moments` fields (populated by `/extensive`). Extend `ExportRequestPayload` to accept either credential shape.

**Deleted files**
- `src/app/api/gong/export/route.ts` — replaced, not dual-maintained.

## Adapter Interface

```ts
export interface ExportAdapter<Creds, RawCall> {
  walkCalls(creds: Creds, filters: CallFilters): AsyncIterable<RawCall>;
  pickMediaFiles(raw: RawCall, mediaType: MediaType): { url: string; filename: string }[];
  fetchTranscript(creds: Creds, raw: RawCall): Promise<string | null>;
  buildSummaryMarkdown(raw: RawCall): string;
  toManifestRow(raw: RawCall, folder: string, status: RowStatus): ManifestRow;
}
```

The streamer receives one adapter instance and never branches on provider.

## Salesloft Adapter Behaviors

**walkCalls**
- `callIds` mode: fetch each via `GET /v2/conversations/:id/extensive` (reuses `fetchConversationById` in `salesloft-client.ts:95-122`).
- `filter` mode: paginate `GET /v2/conversations` with `sort_by=created_at`, `sort_direction=desc`, and `created_at[gt]` / `created_at[lt]` for fromDate / toDate. (The existing `started_at[gt]` filters in `salesloft-client.ts:65-66` are switched to `created_at[gt]` for consistency with the new sort field.)

**pickMediaFiles**
- Calls `fetchConversationRecordingUrl(creds, raw.id)`. Returns `[{ url, filename: "recording.mp3" }]`.
- Salesloft recordings are audio-only; the UI's audio/video/both toggle collapses to "fetch the one recording" for this provider.
- If the user picked `video` and only audio exists, row is marked `media_included: false` — matches Gong's existing behavior for missing variants.

**fetchTranscript**
- Step 1: read the transcription reference off the `/extensive` response (already fetched by `walkCalls`, no extra request).
- Step 2: `GET /v2/transcriptions/:id/sentences` via new `fetchTranscriptionSentences` helper.
- Render each sentence as `Speaker {n}: {text}\n` using a speaker-id-to-number map per call. Pipes into the existing `renderTranscriptText` utility (`src/lib/export/summary.ts:92-108`) or a sibling helper with the same output shape.
- If no transcription reference on the call → return `null` → row marked `transcript_included: false`, no `transcript.txt` written.

**Open question for implementation (not blocking for design):** the exact field name and shape linking a conversation to its transcription on the `/extensive` response could not be confirmed from public docs (Salesloft's doc portal is a JS-rendered SPA and the response schema did not render via WebFetch). The implementation plan's first step is a live API probe against a real Salesloft account to confirm the field name and the sentences response shape (likely `{ data: [{ speaker_id, text, start, end }] }` based on similar APIs). If the link exists under a different path than expected, the adapter accommodates — everything downstream treats the transcript as opaque string output.

**buildSummaryMarkdown**
- Reuses `src/lib/export/summary.ts`.
- Field mapping:
  - title → `c.title ?? c.subject`
  - account → `c.account?.name`
  - date → `c.started_at ?? c.created_at`
  - duration → `c.duration`
  - direction → `c.direction`
  - scope → `c.call_type`
  - attendees → `c.participants` via `inferAffiliation` (already in `salesloft-client.ts:201-213`)
  - Gong's "highlights / topics / trackers" slots become Salesloft's `summary` / `action_items` / `key_moments` (from `/extensive`). Same three-bulleted-sections markdown shape.

## Zip Layout (unchanged for Gong, new for Salesloft)

```
export-YYYY-MM-DD-HHMMSS.zip       (renamed from gong-export-*)
├── manifest.csv                   (existing columns; `provider` column already present)
├── manifest.json
└── {YYYY-MM-DD}_{account}_{title}/
    ├── metadata.json              (raw GongCall or SalesLoftConversation)
    ├── summary.md
    ├── transcript.txt             (omitted if null)
    └── recording.mp3 | recording.mp4
```

## Error Handling & Parity

- **Rate limit (429):** honor `Retry-After`. `salesloft-client.ts:37-43` already parses it; streamer's existing backoff loop applies uniformly.
- **Per-call failures:** non-fatal. Caught in `zip-stream.ts` per-call try/catch; land in manifest row as `status: "failed"`, `error: <message>`. Zip still completes.
- **Missing recording:** row `media_included: false`, no media file written.
- **Missing transcript:** row `transcript_included: false`, no `transcript.txt` written.
- **Auth failure at start of walk (401/403):** abort the whole zip, return HTTP 400 with error body. Matches Gong path.

## Route Contract

`POST /api/export`

Request body (extends existing `ExportRequestPayload`):
```ts
{
  credentials: GongCredentials | SalesLoftCredentials,    // discriminated by `provider`
  callIds?: string[],                                      // XOR with filter
  filter?: { fromDate?: string; toDate?: string },
  options: {
    includeMedia: boolean,
    mediaType: "audio" | "video" | "both",
    includeMetadata: boolean,
    includeTranscripts: boolean
  }
}
```

Response on success: `Content-Type: application/zip`, streamed.
Response on validation failure: HTTP 400 JSON `{ error: string }`.

Validation sequence (both providers):
1. Credentials present and provider-appropriate fields populated.
2. Exactly one of `callIds` or `filter` provided.
3. `options` fields well-typed.
4. Dispatch to adapter; stream zip.

## Out of Scope

- Mixed-provider exports (one zip containing both Gong and Salesloft calls). The credential provider holds exactly one active provider at a time (`src/components/credential-provider.tsx`), so this condition can't arise through the UI.
- New manifest columns for Salesloft-specific fields (`action_items`, `key_moments`). These go into `summary.md` only, keeping the manifest schema stable for anyone scripting against it.
- Changes to `/api/gong/calls`, `/api/salesloft/calls`, `/api/gong/media`, `/api/media`, `/api/gong/import`, `/api/gong/workspaces`.
- OAuth / token-refresh logic for Salesloft. Current bearer-key flow is preserved.

## Verification

- `npx tsc --noEmit` — clean.
- `npm run build` — clean (Next.js 16 / Turbopack).
- **Gong regression:** with a Gong key, select ≥1 call → Download → zip matches pre-change layout bit-for-bit (aside from the top-level filename `export-*`).
- **Salesloft happy path:** with a Salesloft key, select ≥1 call with a recording and a transcription → zip contains `manifest.csv`, `manifest.json`, one `{DATE}_{account}_{title}/` folder with `metadata.json`, `summary.md`, `transcript.txt`, `recording.mp3`.
- **Salesloft no transcription:** select a call without a transcription → manifest row `transcript_included: false`, folder has everything except `transcript.txt`, no error surfaced to user.
- **Salesloft no recording:** select a call without `recording_url` → row `media_included: false`, folder has `metadata.json` + `summary.md` only.
- **Rate limit:** select ~50 Salesloft calls → no 429 cascade; observe serialized backoff in server logs.
- **Deploy:** `vercel --prod`, smoke-test https://gong-explorer-orpin.vercel.app end-to-end.
