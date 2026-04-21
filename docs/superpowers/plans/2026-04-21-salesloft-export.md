# Salesloft Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Salesloft calls to full parity with Gong in the bulk-export zip (metadata.json, summary.md, transcript.txt, recording.mp3, plus the root manifest.csv/json) by dispatching the existing zip streamer through a provider adapter.

**Architecture:** Introduce an `ExportAdapter` interface. Pull Gong-specific pieces out of `src/lib/export/zip-stream.ts` into `adapters/gong.ts`, add a sibling `adapters/salesloft.ts`, and create a provider-agnostic `POST /api/export` route that selects the right adapter from the payload's `credentials.provider`. Delete the old Gong-only route.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, Node 20 runtime, `archiver` for zip streaming, native `fetch`. No unit-test runner configured in this repo — verification uses `npx tsc --noEmit`, `npm run build`, and scripted manual smoke tests against real accounts (same convention as the existing Gong export).

**Related spec:** `docs/superpowers/specs/2026-04-21-salesloft-export-design.md`

---

## File Map

**Create**
- `src/lib/export/adapters/types.ts` — `ExportAdapter<Creds, RawCall>` interface + shared `CallFilters` type.
- `src/lib/export/adapters/gong.ts` — Gong implementation (extracted from current `zip-stream.ts`).
- `src/lib/export/adapters/salesloft.ts` — Salesloft implementation.
- `src/lib/export/adapters/index.ts` — `selectAdapter(provider)` dispatcher.
- `src/lib/export/summary-salesloft.ts` — Salesloft summary markdown + transcript rendering helpers.
- `src/app/api/export/route.ts` — provider-agnostic export endpoint.
- `scripts/probe-salesloft-transcript.mjs` — one-shot probe (Task 1; deleted in Task 14).

**Modify**
- `src/lib/types.ts` — extend `SalesLoftConversation` with transcription + extensive fields; add `SalesLoftExtensiveConversation` type.
- `src/lib/salesloft-client.ts` — add `fetchConversationExtensive`, `fetchTranscriptionSentences` (and adjust `fetchConversations` filter field).
- `src/lib/export/zip-stream.ts` — remove Gong-specific imports; take an `ExportAdapter` instance; generic walk/transcript/media loops.
- `src/hooks/use-export.ts` — POST to `/api/export`.
- `src/hooks/use-bulk-download.ts` — remove Gong-only short-circuit; POST to `/api/export`.
- `src/components/call-detail.tsx:132` — flip `exportSupported` to `true` for both providers (the per-call "download" button on the detail page).

**Delete**
- `src/app/api/gong/export/route.ts` — replaced by `/api/export`.

---

## Pre-flight

- [ ] **Step 0.1: Create a feature branch**

```bash
cd /Users/fermandujar/.superset/projects/gong-explorer
git checkout -b feat/salesloft-export
```

- [ ] **Step 0.2: Verify current typecheck baseline is clean**

Run: `npx tsc --noEmit`
Expected: No output (clean). If it errors, stop — fix the baseline before starting.

---

## Task 1: Probe Salesloft transcription API

Salesloft's docs portal is JS-rendered and couldn't be scraped at design time. Before writing the adapter, we need the exact field that links a conversation to its transcription, plus the shape of `/v2/transcriptions/:id/sentences`. This is a five-minute probe against a real account — everything downstream depends on it.

**Files**
- Create: `scripts/probe-salesloft-transcript.mjs`

- [ ] **Step 1.1: Write the probe script**

```js
// scripts/probe-salesloft-transcript.mjs
// Usage: SALESLOFT_API_KEY=... CONVERSATION_ID=... node scripts/probe-salesloft-transcript.mjs
const apiKey = process.env.SALESLOFT_API_KEY;
const convId = process.env.CONVERSATION_ID;
if (!apiKey || !convId) {
  console.error("Set SALESLOFT_API_KEY and CONVERSATION_ID env vars");
  process.exit(1);
}
const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };

async function probe() {
  // 1) Fetch the extensive conversation
  const extResp = await fetch(
    `https://api.salesloft.com/v2/conversations/${encodeURIComponent(convId)}/extensive`,
    { headers }
  );
  console.log("=== /extensive status:", extResp.status);
  const extBody = await extResp.json();
  console.log("=== /extensive top-level keys:", Object.keys(extBody?.data ?? extBody));
  console.log("=== /extensive full body (truncated 4k):");
  console.log(JSON.stringify(extBody, null, 2).slice(0, 4000));

  // 2) Try to locate a transcription id on the response (any plausible field name)
  const data = extBody?.data ?? {};
  const candidateKeys = Object.keys(data).filter((k) =>
    /transcript/i.test(k) || /transcription/i.test(k)
  );
  console.log("=== transcript-related keys on extensive:", candidateKeys);

  // 3) List transcriptions for the account (helps if extensive doesn't embed the id)
  const listResp = await fetch("https://api.salesloft.com/v2/transcriptions?per_page=5", { headers });
  console.log("=== /v2/transcriptions list status:", listResp.status);
  const listBody = await listResp.json();
  console.log("=== /v2/transcriptions sample entry:");
  console.log(JSON.stringify(listBody?.data?.[0] ?? listBody, null, 2));

  // 4) If we can derive a transcription id, fetch its sentences
  const transcriptionId =
    candidateKeys.map((k) => data[k]).find((v) => v && (typeof v === "string" || typeof v === "number")) ??
    listBody?.data?.[0]?.id;
  if (!transcriptionId) {
    console.log("=== no transcription id discovered — stopping");
    return;
  }
  const sentResp = await fetch(
    `https://api.salesloft.com/v2/transcriptions/${encodeURIComponent(transcriptionId)}/sentences`,
    { headers }
  );
  console.log(`=== /v2/transcriptions/${transcriptionId}/sentences status:`, sentResp.status);
  const sentBody = await sentResp.json();
  console.log("=== sentences sample (first 2):");
  console.log(JSON.stringify((sentBody?.data ?? []).slice(0, 2), null, 2));
}
probe().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 1.2: Run the probe against a real call**

Run (replace with a real Salesloft key and a known conversation id from the app):
```bash
SALESLOFT_API_KEY='<key>' CONVERSATION_ID='<id>' node scripts/probe-salesloft-transcript.mjs | tee /tmp/salesloft-probe.txt
```

Expected: the script prints (a) top-level keys on `/extensive`, (b) any transcript-related field names, (c) a sample transcription list entry, and (d) the sentence response shape.

- [ ] **Step 1.3: Record findings in the plan**

Edit this file, replace the placeholders in the table below with what the probe returned, and commit. These drive the types and adapter code in later tasks.

| Finding | Value (fill in) |
|---|---|
| Transcription reference field on `/extensive` response (e.g. `transcription_id`, `transcript_id`, `transcriptions[0].id`) | `data.transcription.id` — `/extensive` returns `transcription: { id: "08c91f48-...", _href: "..." }` (object, not a bare id field). Also present on the list endpoint. Access via `data.transcription?.id`. |
| Top-level shape of `/v2/transcriptions/:id/sentences` response (e.g. `{ data: [...] }` or `{ sentences: [...] }`) | `{ data: [...], metadata: {...} }` — standard Salesloft envelope; sentences live under `data`. |
| Sentence object keys (e.g. `speaker_id`, `text`, `start_time`, `end_time`) | `id`, `start_time` (float, seconds), `end_time` (float, seconds), `order_number`, `recording_attendee_id` (NOT `speaker_id`), `text`, `conversation: { id, _href }`. No `speaker_id` field — speaker is identified by `recording_attendee_id`. |
| Does `/extensive` return `summary`, `action_items`, `key_moments` directly? Y/N and path | Yes — all three are top-level fields on `data`. `summary` is an object `{ id, text, status, created_at }` (text at `data.summary.text`). `action_items` is `{ status, items: [{ id, original_text, edited_text, created_at, updated_at }] }`. `key_moments` is `{ status, items: [{ name, categories: [...] }] }`. |

- [ ] **Step 1.4: Commit**

```bash
git add scripts/probe-salesloft-transcript.mjs docs/superpowers/plans/2026-04-21-salesloft-export.md
git commit -m "$(cat <<'EOF'
chore(salesloft): add transcript API probe and record findings

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Extend SalesLoftConversation types

Translate the probe findings into types. The field names in the code below assume the most common Salesloft API convention (`transcription_id`, `sentences: [{ speaker_id, text, start_time, end_time }]`). Adjust these names inline to match what Task 1 recorded before running typecheck.

**Files**
- Modify: `src/lib/types.ts`

- [ ] **Step 2.1: Extend `SalesLoftConversation` and add `SalesLoftExtensiveConversation`**

Edit `src/lib/types.ts`. Keep the existing `SalesLoftConversation` interface; add the `transcription_id` field and a new interface for the `/extensive` response.

Replace lines 142-161 with:

```ts
export interface SalesLoftConversation {
  id: number | string;
  title?: string;
  subject?: string;
  started_at?: string;
  created_at?: string;
  updated_at?: string;
  duration?: number; // seconds
  direction?: string;
  call_type?: string;
  recording_url?: string;
  recording_status?: string;
  call_disposition?: string;
  summary?: string;
  participants?: SalesLoftParticipant[];
  user?: { id: number | string; name?: string; email?: string };
  to?: string;
  from?: string;
  account?: { id?: number | string; name?: string };
  // Present on the /extensive response; absent on the list response.
  transcription_id?: string | number;
  action_items?: string[];
  key_moments?: Array<{ start_time?: number; end_time?: number; text?: string; type?: string }>;
}

export interface SalesLoftTranscriptionSentence {
  speaker_id?: string | number;
  text?: string;
  start_time?: number;
  end_time?: number;
}

export interface SalesLoftTranscriptionSentencesResponse {
  data?: SalesLoftTranscriptionSentence[];
}
```

- [ ] **Step 2.2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (This is purely additive — no existing code uses the new fields yet.)

- [ ] **Step 2.3: Commit**

```bash
git add src/lib/types.ts
git commit -m "$(cat <<'EOF'
types(salesloft): add transcription id and extensive-response fields

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add Salesloft transcript + extensive client functions

**Files**
- Modify: `src/lib/salesloft-client.ts`

- [ ] **Step 3.1: Add `fetchConversationExtensive` (returns the extensive raw object, not just the normalized call)**

The existing `fetchConversationById` in `salesloft-client.ts:95-122` returns a `NormalizedCall`. We need the *raw* `SalesLoftConversation` for the export path so we can access `transcription_id`, `action_items`, etc. Add a sibling that returns the raw shape.

Insert this function after `fetchConversationById` (around line 122):

```ts
export async function fetchConversationExtensive(
  creds: SalesLoftCredentials,
  id: string
): Promise<ApiResult<SalesLoftConversation>> {
  try {
    const resp = await fetch(
      `${BASE_URL}/v2/conversations/${encodeURIComponent(id)}/extensive`,
      {
        method: "GET",
        headers: { Authorization: authHeader(creds), Accept: "application/json" },
      }
    );
    const rateLimitRemaining = parseRateLimit(resp);
    if (resp.status === 429) {
      const retryAfter = resp.headers.get("Retry-After");
      return { error: `rate-limited:${retryAfter ?? "60"}`, rateLimitRemaining: 0 };
    }
    if (!resp.ok) return await handleError(resp, rateLimitRemaining);
    const body = (await resp.json()) as { data: SalesLoftConversation };
    if (!body.data) return { error: "Conversation not found", rateLimitRemaining };
    return { data: body.data, rateLimitRemaining };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { error: `Network error: ${message}` };
  }
}
```

Also, add `SalesLoftConversation` to the type imports at the top if it's not already there (it is — line 7 already imports it).

- [ ] **Step 3.2: Add `fetchTranscriptionSentences`**

Insert after `fetchConversationExtensive`:

```ts
export async function fetchTranscriptionSentences(
  creds: SalesLoftCredentials,
  transcriptionId: string
): Promise<ApiResult<SalesLoftTranscriptionSentence[]>> {
  try {
    const resp = await fetch(
      `${BASE_URL}/v2/transcriptions/${encodeURIComponent(transcriptionId)}/sentences?per_page=1000`,
      {
        method: "GET",
        headers: { Authorization: authHeader(creds), Accept: "application/json" },
      }
    );
    const rateLimitRemaining = parseRateLimit(resp);
    if (resp.status === 429) {
      const retryAfter = resp.headers.get("Retry-After");
      return { error: `rate-limited:${retryAfter ?? "60"}`, rateLimitRemaining: 0 };
    }
    if (!resp.ok) return await handleError(resp, rateLimitRemaining);
    const body = (await resp.json()) as SalesLoftTranscriptionSentencesResponse;
    return { data: body.data ?? [], rateLimitRemaining };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { error: `Network error: ${message}` };
  }
}
```

Update the imports at the top of the file to include the new sentence types:

```ts
import type {
  ApiResult,
  NormalizedCall,
  NormalizedCallsResponse,
  NormalizedParty,
  SalesLoftConversation,
  SalesLoftCredentials,
  SalesLoftListResponse,
  SalesLoftParticipant,
  SalesLoftTranscriptionSentence,
  SalesLoftTranscriptionSentencesResponse,
} from "./types";
```

- [ ] **Step 3.3: Fix list-call filter fields (consistency with new `sort_by=created_at`)**

Edit `src/lib/salesloft-client.ts:65-66`. Replace:

```ts
  if (options?.fromDate) params.set("started_at[gt]", options.fromDate);
  if (options?.toDate) params.set("started_at[lt]", options.toDate);
```

with:

```ts
  if (options?.fromDate) params.set("created_at[gt]", options.fromDate);
  if (options?.toDate) params.set("created_at[lt]", options.toDate);
```

- [ ] **Step 3.4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean build. New functions aren't called by anything yet.

- [ ] **Step 3.5: Commit**

```bash
git add src/lib/salesloft-client.ts
git commit -m "$(cat <<'EOF'
feat(salesloft-client): add extensive + transcription-sentences fetchers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Define the ExportAdapter interface

**Files**
- Create: `src/lib/export/adapters/types.ts`

- [ ] **Step 4.1: Write the interface**

Create `src/lib/export/adapters/types.ts` with:

```ts
import type { ExportFilter, ExportOptions, ManifestRow } from "@/lib/types";

export interface MediaFile {
  url: string;
  filename: string; // e.g. "recording.mp3"
}

export interface TranscriptResult {
  text: string | null; // null = no transcript available (non-fatal)
  rateLimitRemaining?: number;
}

export interface AdapterContext {
  filter?: ExportFilter;
  options: ExportOptions;
}

/**
 * Provider-agnostic contract consumed by streamExportZip.
 * Each provider (Gong, Salesloft) supplies one implementation.
 */
export interface ExportAdapter<Creds, RawCall> {
  readonly providerLabel: "gong" | "salesloft";

  walkCalls(
    creds: Creds,
    ctx: AdapterContext & { callIds?: string[] }
  ): AsyncIterable<RawCall>;

  pickMediaFiles(raw: RawCall, mediaType: "audio" | "video" | "both"): MediaFile[];

  fetchTranscript(
    creds: Creds,
    raw: RawCall,
    ctx: AdapterContext
  ): Promise<{ data?: string | null; error?: string; rateLimitRemaining?: number }>;

  buildSummaryMarkdown(raw: RawCall): string;

  toManifestRow(
    raw: RawCall,
    folder: string,
    status: { status: "ok" | "partial" | "error"; error: string; media_included: boolean; transcript_included: boolean }
  ): ManifestRow;

  metadataJson(raw: RawCall): string; // JSON.stringify(raw, null, 2)
}
```

- [ ] **Step 4.2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4.3: Commit**

```bash
git add src/lib/export/adapters/types.ts
git commit -m "$(cat <<'EOF'
feat(export): define provider-agnostic ExportAdapter interface

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Create the Gong adapter (extract from zip-stream)

This is a mechanical extraction — all Gong-specific code in `zip-stream.ts` moves to `adapters/gong.ts`, zero behavior change.

**Files**
- Create: `src/lib/export/adapters/gong.ts`

- [ ] **Step 5.1: Write the Gong adapter**

Create `src/lib/export/adapters/gong.ts`:

```ts
import "server-only";
import type {
  ExportFilter,
  GongCall,
  GongCredentials,
  ManifestRow,
} from "@/lib/types";
import { fetchCallsPage, fetchTranscript } from "@/lib/gong-client";
import { extractAccountName } from "../account";
import { renderSummaryMarkdown, renderTranscriptText } from "../summary";
import type { AdapterContext, ExportAdapter, MediaFile } from "./types";

const RATE_LIMIT_MAX_RETRIES = 3;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function retryRateLimit(error: string, max = 120): Promise<boolean> {
  if (!error.startsWith("rate-limited:")) return false;
  const seconds = Math.min(Number(error.split(":")[1]) || 60, max);
  await sleep(seconds * 1000);
  return true;
}

async function* walkCallsImpl(
  creds: GongCredentials,
  ctx: AdapterContext & { callIds?: string[] }
): AsyncGenerator<GongCall> {
  const filter = ctx.filter;
  const callIds = ctx.callIds;

  if (callIds && callIds.length > 0) {
    const CHUNK_SIZE = 100;
    for (let i = 0; i < callIds.length; i += CHUNK_SIZE) {
      const chunk = callIds.slice(i, i + CHUNK_SIZE);
      let cursor: string | undefined;
      do {
        let attempt = 0;
        for (;;) {
          const result = await fetchCallsPage(creds, { callIds: chunk, cursor });
          if (result.data) {
            for (const call of result.data.calls) yield call;
            cursor = result.data.records.cursor;
            break;
          }
          if (result.error && (await retryRateLimit(result.error)) && attempt < RATE_LIMIT_MAX_RETRIES) {
            attempt++;
            continue;
          }
          throw new Error(result.error ?? "Unknown error fetching calls");
        }
      } while (cursor);
    }
    return;
  }

  let cursor: string | undefined;
  do {
    let attempt = 0;
    for (;;) {
      const result = await fetchCallsPage(creds, {
        fromDate: filter?.fromDate,
        toDate: filter?.toDate,
        cursor,
      });
      if (result.data) {
        for (const call of result.data.calls) yield call;
        cursor = result.data.records.cursor;
        break;
      }
      if (result.error && (await retryRateLimit(result.error)) && attempt < RATE_LIMIT_MAX_RETRIES) {
        attempt++;
        continue;
      }
      throw new Error(result.error ?? "Unknown error fetching calls");
    }
  } while (cursor);
}

function pickMedia(call: GongCall, mediaType: "audio" | "video" | "both"): MediaFile[] {
  const files: MediaFile[] = [];
  if ((mediaType === "audio" || mediaType === "both") && call.media?.audioUrl) {
    files.push({ url: call.media.audioUrl, filename: "recording.mp3" });
  }
  if ((mediaType === "video" || mediaType === "both") && call.media?.videoUrl) {
    files.push({ url: call.media.videoUrl, filename: "recording.mp4" });
  }
  return files;
}

function formatAttendees(parties: GongCall["parties"], aff: "Internal" | "External"): string {
  const filtered = (parties ?? []).filter((p) =>
    aff === "Internal" ? p.affiliation === "Internal" : p.affiliation !== "Internal"
  );
  return filtered.map((p) => p.name ?? p.emailAddress ?? "Unknown").join("; ");
}

export const gongAdapter: ExportAdapter<GongCredentials, GongCall> = {
  providerLabel: "gong",

  walkCalls: walkCallsImpl,

  pickMediaFiles: pickMedia,

  async fetchTranscript(creds, call, ctx) {
    let attempt = 0;
    let result = await fetchTranscript(
      creds,
      call.metaData.id,
      ctx.filter?.fromDate,
      ctx.filter?.toDate
    );
    while (
      result.error &&
      (await retryRateLimit(result.error)) &&
      attempt < RATE_LIMIT_MAX_RETRIES
    ) {
      attempt++;
      result = await fetchTranscript(
        creds,
        call.metaData.id,
        ctx.filter?.fromDate,
        ctx.filter?.toDate
      );
    }
    if (result.data) {
      return { data: renderTranscriptText(result.data), rateLimitRemaining: result.rateLimitRemaining };
    }
    return { data: null, error: result.error, rateLimitRemaining: result.rateLimitRemaining };
  },

  buildSummaryMarkdown(call) {
    return renderSummaryMarkdown(call);
  },

  toManifestRow(call, folder, status) {
    const account = extractAccountName(call.parties);
    const row: ManifestRow = {
      id: call.metaData.id,
      provider: "gong",
      date: call.metaData.started,
      title: call.metaData.title || "Untitled Call",
      account,
      duration_min: Math.round(call.metaData.duration / 60),
      direction: call.metaData.direction,
      system: call.metaData.system,
      internal_attendees: formatAttendees(call.parties, "Internal"),
      external_attendees: formatAttendees(call.parties, "External"),
      outcome: call.content?.callOutcome ?? "",
      folder,
      media_included: status.media_included,
      transcript_included: status.transcript_included,
      status: status.status,
      error: status.error,
    };
    return row;
  },

  metadataJson(call) {
    return JSON.stringify(call, null, 2);
  },
};

// Re-exported so zip-stream can reuse without touching Gong internals directly.
export function buildGongFolderInputs(call: GongCall): { account: string; startedAt: string; title: string } {
  return {
    account: extractAccountName(call.parties),
    startedAt: call.metaData.started,
    title: call.metaData.title || "untitled",
  };
}
```

- [ ] **Step 5.2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (The old zip-stream.ts still works because we haven't removed anything from it yet.)

- [ ] **Step 5.3: Commit**

```bash
git add src/lib/export/adapters/gong.ts
git commit -m "$(cat <<'EOF'
feat(export): add Gong export adapter (behavior parity, extracted)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Salesloft summary + transcript renderers

Salesloft has a different raw shape, so it gets its own summary renderer. Same markdown skeleton as Gong (title → account → metadata → attendees → AI content sections), different field mapping.

**Files**
- Create: `src/lib/export/summary-salesloft.ts`

- [ ] **Step 6.1: Write the Salesloft renderers**

Create `src/lib/export/summary-salesloft.ts`:

```ts
import type {
  SalesLoftConversation,
  SalesLoftParticipant,
  SalesLoftTranscriptionSentence,
} from "@/lib/types";
import { formatDateTime, formatDuration } from "@/lib/format";

function inferAffiliation(
  p: SalesLoftParticipant,
  ownerEmail?: string
): "Internal" | "External" | "Unknown" {
  if (p.role === "rep" || p.role === "user" || p.role === "host") return "Internal";
  if (p.role === "prospect" || p.role === "customer" || p.role === "contact") return "External";
  if (ownerEmail && p.email && p.email.toLowerCase() === ownerEmail.toLowerCase()) return "Internal";
  if (ownerEmail && p.email) {
    const ownerDomain = ownerEmail.split("@")[1]?.toLowerCase();
    const partyDomain = p.email.split("@")[1]?.toLowerCase();
    if (ownerDomain && partyDomain) return ownerDomain === partyDomain ? "Internal" : "External";
  }
  return "Unknown";
}

function partyLine(p: SalesLoftParticipant): string {
  const name = p.name ?? "Unknown";
  const extras = [p.role, p.email].filter(Boolean).join(", ");
  return extras ? `${name} (${extras})` : name;
}

export function renderSalesloftSummaryMarkdown(c: SalesLoftConversation): string {
  const lines: string[] = [];
  const title = c.title ?? c.subject ?? `Conversation ${c.id}`;
  const account = c.account?.name ?? "unknown-account";
  const started = c.started_at ?? c.created_at ?? "";
  const ownerEmail = c.user?.email;

  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`**Account:** ${account}`);
  if (started) lines.push(`**Date:** ${formatDateTime(started)}`);
  if (typeof c.duration === "number") lines.push(`**Duration:** ${formatDuration(c.duration)}`);
  lines.push(`**System:** SalesLoft`);
  if (c.direction) lines.push(`**Direction:** ${c.direction}`);
  if (c.call_type) lines.push(`**Scope:** ${c.call_type}`);
  lines.push("");

  const participants = c.participants ?? [];
  const withAff = participants.map((p) => ({ p, aff: inferAffiliation(p, ownerEmail) }));
  const internal = withAff.filter((x) => x.aff === "Internal").map((x) => x.p);
  const external = withAff.filter((x) => x.aff !== "Internal").map((x) => x.p);

  if (c.user && !participants.some((p) => p.email && c.user?.email && p.email.toLowerCase() === c.user.email.toLowerCase())) {
    internal.unshift({ name: c.user.name, email: c.user.email });
  }

  if (internal.length > 0 || external.length > 0) {
    lines.push("## Attendees");
    if (internal.length > 0) {
      lines.push("");
      lines.push("**Internal:**");
      for (const p of internal) lines.push(`- ${partyLine(p)}`);
    }
    if (external.length > 0) {
      lines.push("");
      lines.push("**External:**");
      for (const p of external) lines.push(`- ${partyLine(p)}`);
    }
    lines.push("");
  }

  if (c.summary) {
    lines.push("## AI Summary");
    lines.push("");
    lines.push(c.summary);
    lines.push("");
  }

  if (c.action_items && c.action_items.length > 0) {
    lines.push("## Action Items");
    lines.push("");
    for (const item of c.action_items) lines.push(`- ${item}`);
    lines.push("");
  }

  if (c.key_moments && c.key_moments.length > 0) {
    lines.push("## Key Moments");
    lines.push("");
    for (const m of c.key_moments) {
      const ts = typeof m.start_time === "number" ? ` (${formatDuration(m.start_time)})` : "";
      const type = m.type ? ` [${m.type}]` : "";
      const text = m.text ?? "";
      lines.push(`- ${text}${type}${ts}`);
    }
    lines.push("");
  }

  if (c.call_disposition) {
    lines.push("## Outcome");
    lines.push("");
    lines.push(c.call_disposition);
    lines.push("");
  }

  return lines.join("\n");
}

export function renderSalesloftTranscriptText(
  sentences: SalesLoftTranscriptionSentence[]
): string {
  // Group consecutive sentences by speaker so output reads like a dialog.
  const lines: string[] = [];
  let currentSpeaker: string | null = null;
  let currentBuffer: string[] = [];

  const flush = () => {
    if (currentSpeaker !== null && currentBuffer.length > 0) {
      lines.push(`${currentSpeaker}: ${currentBuffer.join(" ")}`);
      lines.push("");
    }
    currentBuffer = [];
  };

  for (const s of sentences) {
    const speaker = s.speaker_id !== undefined ? `Speaker ${s.speaker_id}` : "Unknown";
    const text = (s.text ?? "").trim();
    if (!text) continue;
    if (speaker !== currentSpeaker) {
      flush();
      currentSpeaker = speaker;
    }
    currentBuffer.push(text);
  }
  flush();

  return lines.join("\n");
}
```

- [ ] **Step 6.2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6.3: Commit**

```bash
git add src/lib/export/summary-salesloft.ts
git commit -m "$(cat <<'EOF'
feat(export): add Salesloft summary + transcript renderers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Create the Salesloft adapter

**Files**
- Create: `src/lib/export/adapters/salesloft.ts`

- [ ] **Step 7.1: Write the adapter**

Create `src/lib/export/adapters/salesloft.ts`:

```ts
import "server-only";
import type {
  ManifestRow,
  SalesLoftConversation,
  SalesLoftCredentials,
  SalesLoftParticipant,
} from "@/lib/types";
import {
  fetchConversationExtensive,
  fetchConversations,
  fetchConversationRecordingUrl,
  fetchTranscriptionSentences,
} from "@/lib/salesloft-client";
import {
  renderSalesloftSummaryMarkdown,
  renderSalesloftTranscriptText,
} from "../summary-salesloft";
import type { AdapterContext, ExportAdapter, MediaFile } from "./types";

const RATE_LIMIT_MAX_RETRIES = 3;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function retryRateLimit(error: string, max = 120): Promise<boolean> {
  if (!error.startsWith("rate-limited:")) return false;
  const seconds = Math.min(Number(error.split(":")[1]) || 60, max);
  await sleep(seconds * 1000);
  return true;
}

function inferAffiliation(p: SalesLoftParticipant, ownerEmail?: string): "Internal" | "External" | "Unknown" {
  if (p.role === "rep" || p.role === "user" || p.role === "host") return "Internal";
  if (p.role === "prospect" || p.role === "customer" || p.role === "contact") return "External";
  if (ownerEmail && p.email && p.email.toLowerCase() === ownerEmail.toLowerCase()) return "Internal";
  if (ownerEmail && p.email) {
    const od = ownerEmail.split("@")[1]?.toLowerCase();
    const pd = p.email.split("@")[1]?.toLowerCase();
    if (od && pd) return od === pd ? "Internal" : "External";
  }
  return "Unknown";
}

function formatAttendees(
  c: SalesLoftConversation,
  aff: "Internal" | "External"
): string {
  const participants = c.participants ?? [];
  const ownerEmail = c.user?.email;
  return participants
    .filter((p) => {
      const a = inferAffiliation(p, ownerEmail);
      return aff === "Internal" ? a === "Internal" : a !== "Internal";
    })
    .map((p) => p.name ?? p.email ?? "Unknown")
    .join("; ");
}

async function* walkCallsImpl(
  creds: SalesLoftCredentials,
  ctx: AdapterContext & { callIds?: string[] }
): AsyncGenerator<SalesLoftConversation> {
  const callIds = ctx.callIds;
  const filter = ctx.filter;

  if (callIds && callIds.length > 0) {
    // Fetch each call's /extensive response so we get transcription_id etc.
    for (const id of callIds) {
      let attempt = 0;
      for (;;) {
        const result = await fetchConversationExtensive(creds, id);
        if (result.data) {
          yield result.data;
          break;
        }
        if (result.error && (await retryRateLimit(result.error)) && attempt < RATE_LIMIT_MAX_RETRIES) {
          attempt++;
          continue;
        }
        throw new Error(result.error ?? `Unknown error fetching conversation ${id}`);
      }
    }
    return;
  }

  // Filter walk: list conversations (pagination via the existing helper), then fetch
  // /extensive per call so the yielded object carries transcription_id and AI content.
  let page = 1;
  const PER_PAGE = 50;
  for (;;) {
    let attempt = 0;
    let listResult;
    for (;;) {
      listResult = await fetchConversations(creds, {
        page,
        perPage: PER_PAGE,
        fromDate: filter?.fromDate,
        toDate: filter?.toDate,
      });
      if (listResult.data) break;
      if (listResult.error && (await retryRateLimit(listResult.error)) && attempt < RATE_LIMIT_MAX_RETRIES) {
        attempt++;
        continue;
      }
      throw new Error(listResult.error ?? "Unknown error listing conversations");
    }

    for (const normalized of listResult.data.calls) {
      // normalized.id is the conversation id; re-fetch /extensive for full shape.
      let a = 0;
      for (;;) {
        const extResult = await fetchConversationExtensive(creds, normalized.id);
        if (extResult.data) {
          yield extResult.data;
          break;
        }
        if (extResult.error && (await retryRateLimit(extResult.error)) && a < RATE_LIMIT_MAX_RETRIES) {
          a++;
          continue;
        }
        // Non-fatal: log-and-skip for a single call so one bad id doesn't abort the zip.
        console.warn(`[salesloft-export] skipping ${normalized.id}: ${extResult.error}`);
        break;
      }
    }

    if (!listResult.data.cursor) break;
    page = Number(listResult.data.cursor);
    if (!Number.isFinite(page)) break;
  }
}

export const SALESLOFT_RECORDING_SENTINEL = "__salesloft_recording__";

function pickMedia(_c: SalesLoftConversation, mediaType: "audio" | "video" | "both"): MediaFile[] {
  // Salesloft exposes a single recording per call. The UI's audio/video/both toggle
  // collapses to "fetch the recording" for this provider; zip-stream resolves the
  // signed URL at stream time via the sentinel.
  if (mediaType === "video") {
    // User explicitly asked for video only; Salesloft has no distinct video URL.
    return [];
  }
  return [{ url: SALESLOFT_RECORDING_SENTINEL, filename: "recording.mp3" }];
}

export const salesloftAdapter: ExportAdapter<SalesLoftCredentials, SalesLoftConversation> = {
  providerLabel: "salesloft",

  walkCalls: walkCallsImpl,

  pickMediaFiles: pickMedia,

  // Salesloft media is fetched via a signed URL that must be resolved at stream
  // time. zip-stream delegates to this function when it sees the sentinel URL.
  // This is the one place where the generic streamer needs a provider hook.
  // See zip-stream.ts Task 8 for the dispatch.

  async fetchTranscript(creds, c, _ctx) {
    if (c.transcription_id === undefined || c.transcription_id === null) {
      return { data: null };
    }
    const id = String(c.transcription_id);
    let attempt = 0;
    let result = await fetchTranscriptionSentences(creds, id);
    while (
      result.error &&
      (await retryRateLimit(result.error)) &&
      attempt < RATE_LIMIT_MAX_RETRIES
    ) {
      attempt++;
      result = await fetchTranscriptionSentences(creds, id);
    }
    if (result.data) {
      const text = renderSalesloftTranscriptText(result.data);
      return { data: text.length > 0 ? text : null, rateLimitRemaining: result.rateLimitRemaining };
    }
    return { data: null, error: result.error, rateLimitRemaining: result.rateLimitRemaining };
  },

  buildSummaryMarkdown(c) {
    return renderSalesloftSummaryMarkdown(c);
  },

  toManifestRow(c, folder, status) {
    const account = c.account?.name ?? "unknown-account";
    const title = c.title ?? c.subject ?? `Conversation ${c.id}`;
    const date = c.started_at ?? c.created_at ?? "";
    const row: ManifestRow = {
      id: String(c.id),
      provider: "salesloft",
      date,
      title,
      account,
      duration_min: Math.round((c.duration ?? 0) / 60),
      direction: c.direction ?? "",
      system: "SalesLoft",
      internal_attendees: formatAttendees(c, "Internal"),
      external_attendees: formatAttendees(c, "External"),
      outcome: c.call_disposition ?? "",
      folder,
      media_included: status.media_included,
      transcript_included: status.transcript_included,
      status: status.status,
      error: status.error,
    };
    return row;
  },

  metadataJson(c) {
    return JSON.stringify(c, null, 2);
  },
};

/**
 * Resolves the Salesloft signed recording URL at stream time.
 * zip-stream calls this when it encounters the `__salesloft_recording__` sentinel.
 */
export async function resolveSalesloftRecordingUrl(
  creds: SalesLoftCredentials,
  c: SalesLoftConversation
): Promise<{ url: string } | { error: string }> {
  const result = await fetchConversationRecordingUrl(creds, String(c.id));
  if (result.data) return { url: result.data.url };
  return { error: result.error ?? "No recording URL" };
}
```

- [ ] **Step 7.2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7.3: Commit**

```bash
git add src/lib/export/adapters/salesloft.ts
git commit -m "$(cat <<'EOF'
feat(export): add Salesloft export adapter

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Rewrite zip-stream to consume an adapter

This is the surgery. The current `streamExportZip` is Gong-only; it now takes an adapter and delegates all provider-specific work. The Salesloft sentinel URL (`__salesloft_recording__`) is the one place the streamer has to know about providers, since the signed URL has to be fetched lazily per call.

**Files**
- Modify: `src/lib/export/zip-stream.ts`

- [ ] **Step 8.1: Rewrite zip-stream.ts**

Replace the entire contents of `src/lib/export/zip-stream.ts` with:

```ts
import "server-only";
import archiver from "archiver";
import { PassThrough, Readable } from "node:stream";
import type {
  ExportFilter,
  ExportOptions,
  GongCall,
  GongCredentials,
  ManifestRow,
  SalesLoftConversation,
  SalesLoftCredentials,
} from "@/lib/types";
import { assertPublicHttpsUrl } from "@/lib/url-guard";
import { buildCallFolderName } from "./folder-name";
import { buildManifestCsv, buildManifestJson } from "./manifest";
import { gongAdapter, buildGongFolderInputs } from "./adapters/gong";
import {
  salesloftAdapter,
  resolveSalesloftRecordingUrl,
  SALESLOFT_RECORDING_SENTINEL,
} from "./adapters/salesloft";
import type { ExportAdapter } from "./adapters/types";

async function fetchMediaToStream(url: string): Promise<Readable | { error: string }> {
  const guard = assertPublicHttpsUrl(url);
  if ("error" in guard) return { error: guard.error };
  const resp = await fetch(url);
  if (!resp.ok) return { error: `Media fetch failed (${resp.status})` };
  if (!resp.body) return { error: "No media body" };
  return Readable.fromWeb(resp.body as unknown as import("node:stream/web").ReadableStream);
}

function dedupeFolderName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let i = 2;
  while (used.has(`${base}_${i}`)) i++;
  const unique = `${base}_${i}`;
  used.add(unique);
  return unique;
}

function folderInputsFor(
  provider: "gong" | "salesloft",
  call: unknown
): { account: string; startedAt: string; title: string } {
  if (provider === "gong") {
    return buildGongFolderInputs(call as GongCall);
  }
  const c = call as SalesLoftConversation;
  return {
    account: c.account?.name ?? "unknown-account",
    startedAt: c.started_at ?? c.created_at ?? "",
    title: c.title ?? c.subject ?? `Conversation ${c.id}`,
  };
}

export interface StreamExportOptions {
  credentials: GongCredentials | SalesLoftCredentials;
  provider: "gong" | "salesloft";
  callIds?: string[];
  filter?: ExportFilter;
  options: ExportOptions;
}

export function streamExportZip(params: StreamExportOptions): Readable {
  const archive = archiver("zip", { zlib: { level: 5 } });
  const output = new PassThrough();
  archive.pipe(output);
  archive.on("error", (err) => output.destroy(err));

  const adapter: ExportAdapter<unknown, unknown> =
    (params.provider === "gong" ? gongAdapter : salesloftAdapter) as unknown as ExportAdapter<unknown, unknown>;

  (async () => {
    const manifestRows: ManifestRow[] = [];
    const usedFolders = new Set<string>();

    try {
      for await (const call of adapter.walkCalls(params.credentials, {
        callIds: params.callIds,
        filter: params.filter,
        options: params.options,
      })) {
        const fi = folderInputsFor(params.provider, call);
        const baseFolder = buildCallFolderName({
          startedAt: fi.startedAt,
          account: fi.account,
          title: fi.title || "untitled",
        });
        const folder = dedupeFolderName(baseFolder, usedFolders);

        let mediaIncluded = false;
        let transcriptIncluded = false;
        let status: "ok" | "partial" | "error" = "ok";
        let errorMsg = "";

        const includeMetadata = params.options.includeMetadata !== false;
        if (includeMetadata) {
          archive.append(adapter.metadataJson(call), { name: `${folder}/metadata.json` });
          archive.append(adapter.buildSummaryMarkdown(call), { name: `${folder}/summary.md` });
        }

        // Media
        if (params.options.includeMedia) {
          const mediaType = params.options.mediaType ?? "both";
          const mediaFiles = adapter.pickMediaFiles(call, mediaType);
          if (mediaFiles.length > 0) {
            for (const media of mediaFiles) {
              let resolvedUrl = media.url;
              if (resolvedUrl === SALESLOFT_RECORDING_SENTINEL) {
                const resolved = await resolveSalesloftRecordingUrl(
                  params.credentials as SalesLoftCredentials,
                  call as SalesLoftConversation
                );
                if ("error" in resolved) {
                  status = "partial";
                  const msg = `${media.filename}: ${resolved.error}`;
                  errorMsg = errorMsg ? `${errorMsg}; ${msg}` : msg;
                  continue;
                }
                resolvedUrl = resolved.url;
              }

              const streamOrError = await fetchMediaToStream(resolvedUrl);
              if ("error" in streamOrError) {
                status = "partial";
                const msg = `${media.filename}: ${streamOrError.error}`;
                errorMsg = errorMsg ? `${errorMsg}; ${msg}` : msg;
                continue;
              }
              archive.append(streamOrError, { name: `${folder}/${media.filename}` });
              mediaIncluded = true;
              await new Promise<void>((resolve, reject) => {
                const onEntry = (entry: archiver.EntryData) => {
                  if (entry.name === `${folder}/${media.filename}`) {
                    archive.off("entry", onEntry);
                    archive.off("error", onError);
                    resolve();
                  }
                };
                const onError = (err: Error) => {
                  archive.off("entry", onEntry);
                  archive.off("error", onError);
                  reject(err);
                };
                archive.on("entry", onEntry);
                archive.on("error", onError);
              });
            }
          } else {
            status = "partial";
            errorMsg = errorMsg ? `${errorMsg}; no ${mediaType} url` : `no ${mediaType} url`;
          }
        }

        // Transcript
        if (params.options.includeTranscripts) {
          const t = await adapter.fetchTranscript(params.credentials, call, {
            filter: params.filter,
            options: params.options,
          });
          if (t.data) {
            archive.append(t.data, { name: `${folder}/transcript.txt` });
            transcriptIncluded = true;
          } else if (t.error) {
            status = status === "ok" ? "partial" : status;
            const msg = `transcript: ${t.error}`;
            errorMsg = errorMsg ? `${errorMsg}; ${msg}` : msg;
          }
          // t.data === null && !t.error → no transcript available, non-fatal, no row change.
        }

        manifestRows.push(
          adapter.toManifestRow(call, folder, {
            status,
            error: errorMsg,
            media_included: mediaIncluded,
            transcript_included: transcriptIncluded,
          })
        );
      }

      if (params.options.includeMetadata !== false) {
        archive.append(buildManifestCsv(manifestRows), { name: "manifest.csv" });
        archive.append(buildManifestJson(manifestRows), { name: "manifest.json" });
      }

      await archive.finalize();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown export error";
      try {
        archive.append(`Export aborted: ${message}\n`, { name: "ERROR.txt" });
        await archive.finalize();
      } catch {
        output.destroy(err as Error);
      }
    }
  })();

  return output;
}
```

- [ ] **Step 8.2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. The old `/api/gong/export/route.ts` still references the old `streamExportZip` signature — that will fail typecheck. Confirm the error is just in that one file:

```
src/app/api/gong/export/route.ts:116:36 - error TS...
```

That's expected; Task 10 replaces the route.

- [ ] **Step 8.3: Commit**

```bash
git add src/lib/export/zip-stream.ts
git commit -m "$(cat <<'EOF'
refactor(export): provider-agnostic zip-stream via ExportAdapter

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Adapter dispatcher

**Files**
- Create: `src/lib/export/adapters/index.ts`

- [ ] **Step 9.1: Write the dispatcher**

Create `src/lib/export/adapters/index.ts`:

```ts
export { gongAdapter } from "./gong";
export {
  salesloftAdapter,
  resolveSalesloftRecordingUrl,
  SALESLOFT_RECORDING_SENTINEL,
} from "./salesloft";
export type { ExportAdapter, AdapterContext, MediaFile, TranscriptResult } from "./types";
```

- [ ] **Step 9.2: Typecheck**

Run: `npx tsc --noEmit`
Expected: same one error in `/api/gong/export/route.ts` (fixed in Task 10). No new errors.

- [ ] **Step 9.3: Commit**

```bash
git add src/lib/export/adapters/index.ts
git commit -m "$(cat <<'EOF'
feat(export): add adapters barrel export

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Create /api/export route and delete /api/gong/export

**Files**
- Create: `src/app/api/export/route.ts`
- Delete: `src/app/api/gong/export/route.ts`

- [ ] **Step 10.1: Create the new route**

Create `src/app/api/export/route.ts`:

```ts
import { NextRequest } from "next/server";
import { Readable } from "node:stream";
import { streamExportZip } from "@/lib/export/zip-stream";
import type { ExportRequestPayload } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function validate(payload: unknown): ExportRequestPayload | { error: string } {
  if (!payload || typeof payload !== "object") return { error: "Invalid payload" };
  const p = payload as Record<string, unknown>;

  const creds = p.credentials as Record<string, unknown> | undefined;
  if (!creds) return { error: "Missing credentials" };

  if (creds.provider === "gong") {
    if (
      typeof creds.accessKey !== "string" ||
      typeof creds.accessKeySecret !== "string" ||
      typeof creds.baseUrl !== "string"
    ) {
      return { error: "Invalid Gong credentials" };
    }
  } else if (creds.provider === "salesloft") {
    if (typeof creds.apiKey !== "string") {
      return { error: "Invalid Salesloft credentials" };
    }
  } else {
    return { error: "Unsupported provider" };
  }

  const options = p.options as Record<string, unknown> | undefined;
  if (
    !options ||
    typeof options.includeMedia !== "boolean" ||
    typeof options.includeTranscripts !== "boolean"
  ) {
    return { error: "Missing export options" };
  }
  if (
    options.mediaType !== undefined &&
    options.mediaType !== "audio" &&
    options.mediaType !== "video" &&
    options.mediaType !== "both"
  ) {
    return { error: "mediaType must be audio, video, or both" };
  }

  const callIds = p.callIds;
  if (callIds !== undefined && (!Array.isArray(callIds) || callIds.some((id) => typeof id !== "string"))) {
    return { error: "callIds must be an array of strings" };
  }

  const filter = p.filter as Record<string, unknown> | undefined;
  if (filter !== undefined) {
    if (filter.fromDate !== undefined && typeof filter.fromDate !== "string") {
      return { error: "filter.fromDate must be a string" };
    }
    if (filter.toDate !== undefined && typeof filter.toDate !== "string") {
      return { error: "filter.toDate must be a string" };
    }
  }

  if (!callIds && !filter) return { error: "Provide either callIds or filter" };

  const credsOut =
    creds.provider === "gong"
      ? {
          provider: "gong" as const,
          accessKey: creds.accessKey as string,
          accessKeySecret: creds.accessKeySecret as string,
          baseUrl: creds.baseUrl as string,
        }
      : {
          provider: "salesloft" as const,
          apiKey: creds.apiKey as string,
        };

  return {
    credentials: credsOut,
    callIds: callIds as string[] | undefined,
    filter: filter as ExportRequestPayload["filter"],
    options: {
      includeMedia: options.includeMedia as boolean,
      mediaType: options.mediaType as "audio" | "video" | "both" | undefined,
      includeMetadata: options.includeMetadata !== false,
      includeTranscripts: options.includeTranscripts as boolean,
    },
  };
}

async function extractPayload(request: NextRequest): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const raw = form.get("payload");
    if (typeof raw !== "string") return null;
    try { return JSON.parse(raw); } catch { return null; }
  }
  try { return await request.json(); } catch { return null; }
}

export async function POST(request: NextRequest) {
  const payload = await extractPayload(request);
  const parsed = validate(payload);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  const nodeStream = streamExportZip(
    parsed.credentials.provider === "gong"
      ? {
          provider: "gong",
          credentials: {
            accessKey: parsed.credentials.accessKey,
            accessKeySecret: parsed.credentials.accessKeySecret,
            baseUrl: parsed.credentials.baseUrl,
          },
          callIds: parsed.callIds,
          filter: parsed.filter,
          options: parsed.options,
        }
      : {
          provider: "salesloft",
          credentials: { apiKey: parsed.credentials.apiKey },
          callIds: parsed.callIds,
          filter: parsed.filter,
          options: parsed.options,
        }
  );

  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
  const filename = `export-${timestamp()}.zip`;

  return new Response(webStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 10.2: Delete the old route**

```bash
git rm src/app/api/gong/export/route.ts
```

- [ ] **Step 10.3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean typecheck; build prints the new `/api/export` route in the Next.js route table and no longer prints `/api/gong/export`.

- [ ] **Step 10.4: Commit**

```bash
git add src/app/api/export/route.ts
git commit -m "$(cat <<'EOF'
feat(api): provider-agnostic /api/export route; remove /api/gong/export

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Update UI hooks to hit /api/export

**Files**
- Modify: `src/hooks/use-export.ts`
- Modify: `src/hooks/use-bulk-download.ts`

- [ ] **Step 11.1: Update use-export.ts**

Edit `src/hooks/use-export.ts:25`. Replace:

```ts
    form.action = "/api/gong/export";
```

with:

```ts
    form.action = "/api/export";
```

- [ ] **Step 11.2: Update use-bulk-download.ts — remove Gong-only gate + fix route**

Edit `src/hooks/use-bulk-download.ts`. Delete lines 60-76 entirely (the `if (credentials.provider !== "gong") { ... return; }` block). Replace line 116 `form.action = "/api/gong/export";` with `form.action = "/api/export";`.

After the edit, lines 58-114 should read (note the removal of the Gong-only block):

```ts
      if (!credentials) {
        setState({
          status: "complete",
          current: 0,
          total: 0,
          currentFile: "",
          failures: [
            { callId: "", callTitle: "", mediaType: "", error: "Not connected" },
          ],
        });
        return;
      }

      if (calls.length === 0) {
        setState({
          status: "complete",
          current: 0,
          total: 0,
          currentFile: "",
          failures: [
            { callId: "", callTitle: "", mediaType: "", error: "No calls selected" },
          ],
        });
        return;
      }

      const callIds = calls
        .map((c) => c.id ?? c.metaData?.id)
        .filter((id): id is string => typeof id === "string");

      setState({
        status: "starting",
        current: 0,
        total: callIds.length,
        currentFile: "preparing server-side zip...",
        failures: [],
      });

      const payload: ExportRequestPayload = {
        credentials,
        callIds,
        options: {
          includeMedia: true,
          mediaType,
          includeMetadata: extras?.includeMetadata ?? true,
          includeTranscripts: extras?.includeTranscripts ?? false,
        },
      };

      const form = document.createElement("form");
      form.method = "POST";
      form.action = "/api/export";
```

- [ ] **Step 11.3: Flip exportSupported in call-detail.tsx**

Edit `src/components/call-detail.tsx:132`. Replace:

```ts
  const exportSupported = provider === "gong";
```

with:

```ts
  const exportSupported = provider === "gong" || provider === "salesloft";
```

- [ ] **Step 11.4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 11.5: Commit**

```bash
git add src/hooks/use-export.ts src/hooks/use-bulk-download.ts src/components/call-detail.tsx
git commit -m "$(cat <<'EOF'
feat(ui): wire bulk/single export to /api/export for both providers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Gong regression smoke test

No code change here — this is a gate before touching Salesloft.

- [ ] **Step 12.1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 12.2: Exercise Gong export in the browser**

Open http://localhost:3000, connect with a Gong API key, select 2 calls (ideally one with video and one without), click **Download** with media type `Both`, include transcripts checked. A zip named `export-YYYY-MM-DD-HHMMSS.zip` should download.

- [ ] **Step 12.3: Verify zip contents**

```bash
unzip -l ~/Downloads/export-*.zip | head -30
```

Expected listing must include:
- `manifest.csv`
- `manifest.json`
- Per-call `{date}_{account}_{title}/` folders each containing `metadata.json`, `summary.md`, `transcript.txt`, and `recording.mp3` and/or `recording.mp4`.

Also open one folder's `summary.md` and confirm the Gong-specific sections (Highlights, Topics, Trackers) render the same as before this branch.

- [ ] **Step 12.4: Stop the dev server**

If anything is wrong, stop here and debug before touching Salesloft. Gong parity is the contract.

---

## Task 13: Salesloft end-to-end smoke test

- [ ] **Step 13.1: Start dev server (if stopped)**

```bash
npm run dev
```

- [ ] **Step 13.2: Exercise Salesloft export — happy path**

In the browser, switch to Salesloft by entering a Salesloft API key. Select one call that has a recording and a known transcription. Click **Download**.

- [ ] **Step 13.3: Verify zip contents**

```bash
unzip -l ~/Downloads/export-*.zip
```

Expected:
- `manifest.csv` — one row with `provider=salesloft`, `media_included=true`, `transcript_included=true`, `status=ok`.
- `manifest.json` — same row.
- `{date}_{account}_{title}/metadata.json` — raw `SalesLoftConversation` JSON.
- `{date}_{account}_{title}/summary.md` — Attendees + AI Summary + Action Items + Key Moments sections populated from `/extensive`.
- `{date}_{account}_{title}/transcript.txt` — `Speaker N: <text>` lines grouped by speaker.
- `{date}_{account}_{title}/recording.mp3` — plays in a media player.

- [ ] **Step 13.4: Missing-transcript case**

Select a Salesloft call known NOT to have a transcription (e.g. a very short call, or one with `transcription_id` absent per the Task 1 probe). Download. Verify:
- `manifest.csv` row has `transcript_included=false`.
- The per-call folder contains no `transcript.txt`.
- Status is `ok` (not `partial`) — missing transcript is non-fatal.

- [ ] **Step 13.5: Missing-recording case**

Select a Salesloft call without `recording_url`. Download. Verify:
- `manifest.csv` row has `media_included=false`, `status=partial`, `error=recording.mp3: No recording URL` (or similar).
- The per-call folder contains `metadata.json` and `summary.md` only.
- Zip completes successfully.

- [ ] **Step 13.6: Multi-call batch**

Select 10 Salesloft calls. Download. Verify all 10 folders + manifest rows land. Watch the Next.js dev server logs — no 429 cascade, no unhandled rejections.

- [ ] **Step 13.7: Stop the dev server**

If any of 13.2–13.6 failed, debug before moving on. The adapter signatures are the most likely suspect if the probe (Task 1) field names turned out differently.

---

## Task 14: Clean up the probe script

- [ ] **Step 14.1: Delete the probe script**

```bash
git rm scripts/probe-salesloft-transcript.mjs
rmdir scripts 2>/dev/null || true
```

- [ ] **Step 14.2: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(salesloft): remove one-shot transcript probe script

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Merge and deploy

- [ ] **Step 15.1: Final typecheck + build**

```bash
npx tsc --noEmit && npm run build
```

Expected: clean. If not, stop and fix.

- [ ] **Step 15.2: Merge the branch into main**

```bash
git checkout main
git merge --no-ff feat/salesloft-export
```

- [ ] **Step 15.3: Push**

```bash
git push origin main
```

- [ ] **Step 15.4: Deploy to Vercel production**

Confirm with the user before running this — production deploy, visible to anyone hitting the site.

```bash
vercel --prod
```

- [ ] **Step 15.5: Post-deploy smoke test**

Visit https://gong-explorer-orpin.vercel.app, connect a Salesloft API key, select one call, download. Same checks as Task 13.3. If anything breaks in prod that worked locally, suspect environment differences (Node version, maxDuration limits, Vercel response streaming quirks) and debug from server logs.

---

## Verification Summary

After all tasks:

- [ ] `npx tsc --noEmit` — clean.
- [ ] `npm run build` — clean; route table shows `/api/export` (and not `/api/gong/export`).
- [ ] Gong happy-path regression — zip layout bit-for-bit identical to pre-branch except top-level filename (`export-*` instead of `gong-export-*`).
- [ ] Salesloft happy-path — zip contains manifest + per-call folders with `metadata.json`, `summary.md`, `transcript.txt`, `recording.mp3`.
- [ ] Salesloft missing transcript — row `transcript_included=false`, no transcript file, `status=ok`.
- [ ] Salesloft missing recording — row `media_included=false`, `status=partial`, zip still completes.
- [ ] Production deploy smoke test at https://gong-explorer-orpin.vercel.app passes.
