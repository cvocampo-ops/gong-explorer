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
  SalesLoftExtensiveConversation,
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
  const c = call as SalesLoftExtensiveConversation;
  return {
    account: c.account?.name ?? "unknown-account",
    startedAt: c.started_at ?? c.created_at ?? "",
    title: c.title ?? c.subject ?? `Conversation ${c.id}`,
  };
}

export type StreamExportOptions =
  | {
      provider: "gong";
      credentials: GongCredentials;
      callIds?: string[];
      filter?: ExportFilter;
      options: ExportOptions;
    }
  | {
      provider: "salesloft";
      credentials: SalesLoftCredentials;
      callIds?: string[];
      filter?: ExportFilter;
      options: ExportOptions;
    };

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
