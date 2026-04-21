import "server-only";
import type {
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

/**
 * Folder inputs used by the generic zip-streamer (which builds the per-call
 * folder name via buildCallFolderName). Exported so zip-stream.ts in Task 8 can
 * request these without knowing Gong's internal shape.
 */
export function buildGongFolderInputs(call: GongCall): {
  account: string;
  startedAt: string;
  title: string;
} {
  return {
    account: extractAccountName(call.parties),
    startedAt: call.metaData.started,
    title: call.metaData.title || "untitled",
  };
}
