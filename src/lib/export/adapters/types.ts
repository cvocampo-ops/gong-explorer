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
    status: {
      status: "ok" | "partial" | "error";
      error: string;
      media_included: boolean;
      transcript_included: boolean;
    }
  ): ManifestRow;

  metadataJson(raw: RawCall): string; // JSON.stringify(raw, null, 2)
}
