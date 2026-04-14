import "server-only";
import archiver from "archiver";
import { PassThrough, Readable } from "node:stream";
import type {
  ExportOptions,
  ExportFilter,
  GongCall,
  GongCredentials,
  ManifestRow,
} from "@/lib/types";
import { fetchCallsPage, fetchTranscript } from "@/lib/gong-client";
import { assertPublicHttpsUrl } from "@/lib/url-guard";
import { extractAccountName } from "./account";
import { buildCallFolderName } from "./folder-name";
import { renderSummaryMarkdown, renderTranscriptText } from "./summary";
import { buildManifestCsv, buildManifestJson } from "./manifest";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RATE_LIMIT_BUFFER_THRESHOLD = 100;
const RATE_LIMIT_PAUSE_MS = 2000;
const MAX_RETRY_AFTER_SECONDS = 120;

async function applyRateLimitBackoff(remaining: number | undefined): Promise<void> {
  if (remaining !== undefined && remaining < RATE_LIMIT_BUFFER_THRESHOLD) {
    await sleep(RATE_LIMIT_PAUSE_MS);
  }
}

async function parseRateLimitError(error: string): Promise<boolean> {
  if (error.startsWith("rate-limited:")) {
    const seconds = Math.min(
      Number(error.split(":")[1]) || 60,
      MAX_RETRY_AFTER_SECONDS
    );
    await sleep(seconds * 1000);
    return true;
  }
  return false;
}

async function* walkCalls(
  creds: GongCredentials,
  filter: ExportFilter | undefined,
  callIds: string[] | undefined
): AsyncGenerator<GongCall> {
  if (callIds && callIds.length > 0) {
    // Gong supports up to 100 callIds per request
    const CHUNK_SIZE = 100;
    for (let i = 0; i < callIds.length; i += CHUNK_SIZE) {
      const chunk = callIds.slice(i, i + CHUNK_SIZE);
      let cursor: string | undefined;
      do {
        let attempt = 0;
        for (;;) {
          const result = await fetchCallsPage(creds, { callIds: chunk, cursor });
          await applyRateLimitBackoff(result.rateLimitRemaining);
          if (result.data) {
            for (const call of result.data.calls) yield call;
            cursor = result.data.records.cursor;
            break;
          }
          if (result.error && (await parseRateLimitError(result.error)) && attempt < 3) {
            attempt++;
            continue;
          }
          throw new Error(result.error ?? "Unknown error fetching calls");
        }
      } while (cursor);
    }
    return;
  }

  // Filter-based walk
  let cursor: string | undefined;
  do {
    let attempt = 0;
    for (;;) {
      const result = await fetchCallsPage(creds, {
        fromDate: filter?.fromDate,
        toDate: filter?.toDate,
        cursor,
      });
      await applyRateLimitBackoff(result.rateLimitRemaining);
      if (result.data) {
        for (const call of result.data.calls) yield call;
        cursor = result.data.records.cursor;
        break;
      }
      if (result.error && (await parseRateLimitError(result.error)) && attempt < 3) {
        attempt++;
        continue;
      }
      throw new Error(result.error ?? "Unknown error fetching calls");
    }
  } while (cursor);
}

async function fetchMediaToStream(url: string): Promise<Readable | { error: string }> {
  const guard = assertPublicHttpsUrl(url);
  if ("error" in guard) return { error: guard.error };

  const resp = await fetch(url);
  if (!resp.ok) {
    return { error: `Media fetch failed (${resp.status})` };
  }
  if (!resp.body) {
    return { error: "No media body" };
  }
  // Convert Web ReadableStream to Node Readable for archiver
  return Readable.fromWeb(resp.body as unknown as import("node:stream/web").ReadableStream);
}

function pickMediaFiles(
  call: GongCall,
  mediaType: "audio" | "video" | "both"
): Array<{ url: string; filename: string }> {
  const files: Array<{ url: string; filename: string }> = [];
  if ((mediaType === "audio" || mediaType === "both") && call.media?.audioUrl) {
    files.push({ url: call.media.audioUrl, filename: "recording.mp3" });
  }
  if ((mediaType === "video" || mediaType === "both") && call.media?.videoUrl) {
    files.push({ url: call.media.videoUrl, filename: "recording.mp4" });
  }
  return files;
}

function formatAttendees(
  parties: GongCall["parties"],
  affiliation: "Internal" | "External"
): string {
  const filtered = (parties ?? []).filter((p) =>
    affiliation === "Internal" ? p.affiliation === "Internal" : p.affiliation !== "Internal"
  );
  return filtered.map((p) => p.name ?? p.emailAddress ?? "Unknown").join("; ");
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

export interface StreamExportOptions {
  credentials: GongCredentials;
  callIds?: string[];
  filter?: ExportFilter;
  options: ExportOptions;
}

export function streamExportZip(params: StreamExportOptions): Readable {
  const archive = archiver("zip", { zlib: { level: 5 } });
  const output = new PassThrough();
  archive.pipe(output);

  // Surface archiver errors to the output stream
  archive.on("error", (err) => {
    output.destroy(err);
  });

  // Run the async build; errors get propagated by destroying the stream
  (async () => {
    const manifestRows: ManifestRow[] = [];
    const usedFolders = new Set<string>();

    try {
      for await (const call of walkCalls(params.credentials, params.filter, params.callIds)) {
        const account = extractAccountName(call.parties);
        const baseFolder = buildCallFolderName({
          startedAt: call.metaData.started,
          account,
          title: call.metaData.title || "untitled",
        });
        const folder = dedupeFolderName(baseFolder, usedFolders);

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
          media_included: false,
          transcript_included: false,
          status: "ok",
          error: "",
        };

        const includeMetadata = params.options.includeMetadata !== false;
        if (includeMetadata) {
          archive.append(JSON.stringify(call, null, 2), { name: `${folder}/metadata.json` });
          archive.append(renderSummaryMarkdown(call), { name: `${folder}/summary.md` });
        }

        // Media
        if (params.options.includeMedia) {
          const mediaType = params.options.mediaType ?? "both";
          const mediaFiles = pickMediaFiles(call, mediaType);
          if (mediaFiles.length > 0) {
            for (const media of mediaFiles) {
              const streamOrError = await fetchMediaToStream(media.url);
              if ("error" in streamOrError) {
                row.status = "partial";
                const msg = `${media.filename}: ${streamOrError.error}`;
                row.error = row.error ? `${row.error}; ${msg}` : msg;
                continue;
              }
              archive.append(streamOrError, { name: `${folder}/${media.filename}` });
              row.media_included = true;
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
            row.status = "partial";
            row.error = row.error ? `${row.error}; no ${mediaType} url` : `no ${mediaType} url`;
          }
        }

        // Transcript
        if (params.options.includeTranscripts) {
          let attempt = 0;
          let transcriptResult = await fetchTranscript(
            params.credentials,
            call.metaData.id,
            params.filter?.fromDate,
            params.filter?.toDate
          );
          while (
            transcriptResult.error &&
            (await parseRateLimitError(transcriptResult.error)) &&
            attempt < 3
          ) {
            attempt++;
            transcriptResult = await fetchTranscript(
              params.credentials,
              call.metaData.id,
              params.filter?.fromDate,
              params.filter?.toDate
            );
          }
          await applyRateLimitBackoff(transcriptResult.rateLimitRemaining);

          if (transcriptResult.data) {
            archive.append(renderTranscriptText(transcriptResult.data), {
              name: `${folder}/transcript.txt`,
            });
            row.transcript_included = true;
          } else if (transcriptResult.error) {
            row.status = row.status === "ok" ? "partial" : row.status;
            const msg = `transcript: ${transcriptResult.error}`;
            row.error = row.error ? `${row.error}; ${msg}` : msg;
          }
        }

        manifestRows.push(row);
      }

      // Top-level manifest files (only if including metadata)
      if (params.options.includeMetadata !== false) {
        archive.append(buildManifestCsv(manifestRows), { name: "manifest.csv" });
        archive.append(buildManifestJson(manifestRows), { name: "manifest.json" });
      }

      await archive.finalize();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown export error";
      // Best effort: append an error notice, then destroy
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
