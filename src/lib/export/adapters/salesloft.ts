import "server-only";
import type {
  ManifestRow,
  SalesLoftConversation,
  SalesLoftCredentials,
  SalesLoftExtensiveConversation,
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

/**
 * Sentinel URL returned by pickMediaFiles for Salesloft. The generic zip-streamer
 * detects this literal and resolves the real signed URL via
 * resolveSalesloftRecordingUrl at stream time.
 */
export const SALESLOFT_RECORDING_SENTINEL = "__salesloft_recording__";

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
  c: SalesLoftExtensiveConversation,
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
): AsyncGenerator<SalesLoftExtensiveConversation> {
  const callIds = ctx.callIds;
  const filter = ctx.filter;

  if (callIds && callIds.length > 0) {
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

  // Filter walk: list conversations (the existing fetchConversations returns NormalizedCall
  // objects via toNormalizedCall), then re-fetch each via /extensive to get transcription + AI content.
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
        // Non-fatal: log-and-skip so one bad id doesn't abort the whole zip.
        console.warn(`[salesloft-export] skipping ${normalized.id}: ${extResult.error}`);
        break;
      }
    }

    if (!listResult.data.cursor) break;
    const next = Number(listResult.data.cursor);
    if (!Number.isFinite(next)) break;
    page = next;
  }
}

function pickMedia(
  _c: SalesLoftExtensiveConversation,
  mediaType: "audio" | "video" | "both"
): MediaFile[] {
  // Salesloft exposes a single recording per call. The audio/video/both toggle
  // collapses to "fetch the recording" for this provider; zip-stream resolves the
  // signed URL at stream time via the sentinel.
  if (mediaType === "video") {
    // User asked for video only; Salesloft has no distinct video URL.
    return [];
  }
  // Salesloft serves audio-only AAC inside an MP4 container. Use the .m4a
  // extension so downstream Gong import sends the correct audio/mp4 content
  // type — previously this was labeled .mp3 but the bytes aren't MP3, which
  // caused Gong's media endpoint to reject the upload.
  return [{ url: SALESLOFT_RECORDING_SENTINEL, filename: "recording.m4a" }];
}

export const salesloftAdapter: ExportAdapter<SalesLoftCredentials, SalesLoftExtensiveConversation> = {
  providerLabel: "salesloft",

  walkCalls: walkCallsImpl,

  pickMediaFiles: pickMedia,

  async fetchTranscript(creds, c, _ctx) {
    const transcriptionId = c.transcription?.id;
    if (!transcriptionId) {
      return { data: null };
    }
    let attempt = 0;
    let result = await fetchTranscriptionSentences(creds, String(transcriptionId));
    while (
      result.error &&
      (await retryRateLimit(result.error)) &&
      attempt < RATE_LIMIT_MAX_RETRIES
    ) {
      attempt++;
      result = await fetchTranscriptionSentences(creds, String(transcriptionId));
    }
    if (result.data) {
      const text = renderSalesloftTranscriptText(result.data);
      return {
        data: text.length > 0 ? text : null,
        rateLimitRemaining: result.rateLimitRemaining,
      };
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
      duration_min: Math.round((c.duration ?? 0) / 60000),
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
 * zip-stream calls this when it encounters the SALESLOFT_RECORDING_SENTINEL.
 */
export async function resolveSalesloftRecordingUrl(
  creds: SalesLoftCredentials,
  c: SalesLoftConversation
): Promise<{ url: string } | { error: string }> {
  const result = await fetchConversationRecordingUrl(creds, String(c.id));
  if (result.data) return { url: result.data.url };
  return { error: result.error ?? "No recording URL" };
}
