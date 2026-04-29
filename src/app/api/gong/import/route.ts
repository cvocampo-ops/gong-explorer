import { NextRequest } from "next/server";
import JSZip from "jszip";
import { del as deleteBlob } from "@vercel/blob";
import { importCall } from "@/lib/gong-client";
import {
  mapExportToImportMetadata,
  type RawGongExport,
  type MapperOverrides,
} from "@/lib/gong-export-mapper";
import type {
  GongCredentials,
  ImportCallMetadata,
  BulkImportRow,
  BulkImportResult,
} from "@/lib/types";

const ALLOWED_MEDIA_TYPES = new Set([
  "video/mp4",
  "video/x-matroska",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/flac",
  "application/octet-stream",
]);

const RECORDING_EXTENSIONS = ["mp4", "m4a", "mp3", "wav", "mkv", "flac"] as const;
const MEDIA_PREFERENCE = ["mp4", "m4a", "mp3", "wav", "flac", "mkv"];

const MAX_FILE_SIZE = 1.5 * 1024 * 1024 * 1024; // 1.5 GB

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  mkv: "video/x-matroska",
};

interface ManifestRow {
  id?: string;
  folder?: string;
  title?: string;
  media_included?: boolean;
  status?: string;
  error?: string;
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";

  // --- Multipart modes (manual upload OR zip) ---
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const mode = (formData.get("mode") as string | null) ?? "manual";

    const credentials = parseCredentials(formData.get("credentials"));
    if (!credentials) {
      return Response.json({ error: "Missing or invalid credentials" }, { status: 400 });
    }

    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return Response.json({ error: "Missing file" }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return Response.json(
        { error: "File exceeds maximum size of 1.5 GB" },
        { status: 400 }
      );
    }

    if (mode === "zip") {
      const overrides = parseOverrides(formData.get("overrides"));
      return handleZipImport(file, credentials, overrides);
    }

    // mode === "manual"
    return handleManualImport(file, credentials, formData.get("metadata"));
  }

  // --- JSON modes ---
  const body = (await request.json()) as {
    mode?: "automatic" | "zip" | "manual";
    credentials?: { provider?: string } & GongCredentials;
    metadata?: ImportCallMetadata;
    sourceUrl?: string;
    blobUrl?: string;
    contentType?: string;
    overrides?: MapperOverrides;
  };

  if (!body.credentials?.accessKey || !body.credentials?.accessKeySecret || !body.credentials?.baseUrl) {
    return Response.json({ error: "Missing credentials" }, { status: 400 });
  }

  const creds: GongCredentials = {
    accessKey: body.credentials.accessKey,
    accessKeySecret: body.credentials.accessKeySecret,
    baseUrl: body.credentials.baseUrl,
  };

  const mode = body.mode ?? (body.sourceUrl ? "automatic" : undefined);

  if (mode === "zip") {
    if (!body.blobUrl) {
      return Response.json({ error: "Missing blobUrl for ZIP import" }, { status: 400 });
    }
    return handleZipFromBlob(body.blobUrl, creds, body.overrides);
  }

  if (mode === "manual") {
    if (!body.blobUrl) {
      return Response.json({ error: "Missing blobUrl for manual import" }, { status: 400 });
    }
    if (!body.metadata) {
      return Response.json({ error: "Missing call metadata" }, { status: 400 });
    }
    return handleManualFromBlob(
      body.blobUrl,
      body.contentType ?? "application/octet-stream",
      creds,
      body.metadata
    );
  }

  // mode === "automatic"
  if (!body.metadata) {
    return Response.json({ error: "Missing call metadata" }, { status: 400 });
  }
  if (!body.sourceUrl) {
    return Response.json(
      { error: "Missing sourceUrl for automatic import" },
      { status: 400 }
    );
  }

  const result = await importCall(creds, body.metadata, { sourceUrl: body.sourceUrl });
  if (result.error) {
    return Response.json({ error: result.error }, { status: 502 });
  }
  return Response.json(result.data);
}

async function fetchBlobBuffer(blobUrl: string): Promise<ArrayBuffer> {
  const resp = await fetch(blobUrl);
  if (!resp.ok) {
    throw new Error(`Failed to fetch blob (${resp.status}): ${resp.statusText}`);
  }
  return resp.arrayBuffer();
}

async function tryDeleteBlob(blobUrl: string): Promise<void> {
  try {
    await deleteBlob(blobUrl);
  } catch {
    // Best-effort cleanup; don't fail the import if cleanup fails.
  }
}

async function handleManualFromBlob(
  blobUrl: string,
  contentType: string,
  creds: GongCredentials,
  metadata: ImportCallMetadata
) {
  let buffer: ArrayBuffer;
  try {
    buffer = await fetchBlobBuffer(blobUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 502 });
  }

  if (buffer.byteLength > MAX_FILE_SIZE) {
    await tryDeleteBlob(blobUrl);
    return Response.json({ error: "File exceeds 1.5 GB limit." }, { status: 400 });
  }

  const result = await importCall(creds, metadata, { buffer, contentType });
  await tryDeleteBlob(blobUrl);

  if (result.error) {
    return Response.json({ error: result.error }, { status: 502 });
  }
  return Response.json(result.data);
}

async function handleZipFromBlob(
  blobUrl: string,
  creds: GongCredentials,
  overrides: MapperOverrides | undefined
) {
  let buffer: ArrayBuffer;
  try {
    buffer = await fetchBlobBuffer(blobUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 502 });
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (err) {
    await tryDeleteBlob(blobUrl);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: `Failed to read ZIP: ${message}` }, { status: 400 });
  }

  const manifestEntry = findManifestEntry(zip);
  let response: Response;
  if (manifestEntry) {
    response = await runFullExportImport(zip, manifestEntry, creds, overrides);
  } else {
    response = await runSingleCallImport(zip, creds, overrides);
  }

  await tryDeleteBlob(blobUrl);
  return response;
}

async function runSingleCallImport(
  zip: JSZip,
  creds: GongCredentials,
  overrides: MapperOverrides | undefined
): Promise<Response> {
  const single = await extractSingleCall(zip);
  if (!single) {
    return Response.json(
      {
        error:
          "ZIP must contain either a metadata.json (single call) or manifest.json (full export).",
      },
      { status: 400 }
    );
  }

  const metadata = mapExportToImportMetadata(single.raw, overrides);
  if (!metadata.primaryUser) {
    return Response.json(
      { error: "metadata.json is missing primaryUserId; cannot import." },
      { status: 400 }
    );
  }
  if (single.media.byteLength > MAX_FILE_SIZE) {
    return Response.json(
      { error: "Recording inside ZIP exceeds 1.5 GB limit." },
      { status: 400 }
    );
  }

  const result = await importCall(creds, metadata, {
    buffer: single.media,
    contentType: single.contentType,
  });
  if (result.error) {
    return Response.json({ error: result.error }, { status: 502 });
  }
  return Response.json(result.data);
}

// ----------------- Helpers -----------------

function parseCredentials(raw: FormDataEntryValue | null): GongCredentials | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as Partial<GongCredentials> & { provider?: string };
    if (!parsed.accessKey || !parsed.accessKeySecret || !parsed.baseUrl) return null;
    return {
      accessKey: parsed.accessKey,
      accessKeySecret: parsed.accessKeySecret,
      baseUrl: parsed.baseUrl,
    };
  } catch {
    return null;
  }
}

function parseOverrides(raw: FormDataEntryValue | null): MapperOverrides | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  try {
    const parsed = JSON.parse(raw) as MapperOverrides;
    return parsed;
  } catch {
    return undefined;
  }
}

async function handleManualImport(
  file: File,
  creds: GongCredentials,
  metadataRaw: FormDataEntryValue | null
) {
  const fileType = file.type || "application/octet-stream";
  if (!ALLOWED_MEDIA_TYPES.has(fileType)) {
    return Response.json(
      { error: `Unsupported file type: ${fileType}. Supported: WAV, MP3, MP4, MKV, FLAC` },
      { status: 400 }
    );
  }

  if (!metadataRaw || typeof metadataRaw !== "string") {
    return Response.json({ error: "Missing metadata" }, { status: 400 });
  }

  let metadata: ImportCallMetadata;
  try {
    metadata = JSON.parse(metadataRaw) as ImportCallMetadata;
  } catch {
    return Response.json({ error: "Invalid metadata JSON" }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  const result = await importCall(creds, metadata, { buffer, contentType: fileType });
  if (result.error) {
    return Response.json({ error: result.error }, { status: 502 });
  }
  return Response.json(result.data);
}

async function handleZipImport(
  file: File,
  creds: GongCredentials,
  overrides: MapperOverrides | undefined
) {
  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith(".zip")) {
    return Response.json({ error: "Uploaded file must be a .zip" }, { status: 400 });
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: `Failed to read ZIP: ${message}` }, { status: 400 });
  }

  const manifestEntry = findManifestEntry(zip);
  if (manifestEntry) {
    return runFullExportImport(zip, manifestEntry, creds, overrides);
  }
  return runSingleCallImport(zip, creds, overrides);
}

function findManifestEntry(zip: JSZip): JSZip.JSZipObject | null {
  let found: JSZip.JSZipObject | null = null;
  zip.forEach((path, entry) => {
    if (entry.dir) return;
    const name = path.split("/").pop() ?? "";
    if (name.toLowerCase() === "manifest.json") {
      // Prefer the shallowest manifest.json (top-level wins).
      if (!found || path.split("/").length < found.name.split("/").length) {
        found = entry;
      }
    }
  });
  return found;
}

interface SingleCallExtraction {
  raw: RawGongExport;
  media: ArrayBuffer;
  contentType: string;
  recordingPath: string;
}

async function extractSingleCall(zip: JSZip): Promise<SingleCallExtraction | null> {
  // Find a metadata.json (any depth).
  let metadataEntry: JSZip.JSZipObject | null = null;
  zip.forEach((path, entry) => {
    if (entry.dir) return;
    if (path.split("/").pop()?.toLowerCase() === "metadata.json") {
      if (!metadataEntry) metadataEntry = entry;
    }
  });
  if (!metadataEntry) return null;

  const metaText = await (metadataEntry as JSZip.JSZipObject).async("string");
  let raw: RawGongExport;
  try {
    raw = JSON.parse(metaText) as RawGongExport;
  } catch {
    return null;
  }

  const dirPrefix = (metadataEntry as JSZip.JSZipObject).name.replace(/metadata\.json$/i, "");
  const recordingEntry = pickRecordingFromDir(zip, dirPrefix);
  if (!recordingEntry) return null;

  const media = await recordingEntry.async("arraybuffer");
  const ext = recordingEntry.name.split(".").pop()?.toLowerCase() ?? "";
  const contentType = CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream";

  return { raw, media, contentType, recordingPath: recordingEntry.name };
}

function pickRecordingFromDir(zip: JSZip, dirPrefix: string): JSZip.JSZipObject | null {
  const candidates: JSZip.JSZipObject[] = [];
  zip.forEach((path, entry) => {
    if (entry.dir) return;
    if (!path.startsWith(dirPrefix)) return;
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    if ((RECORDING_EXTENSIONS as readonly string[]).includes(ext)) {
      candidates.push(entry);
    }
  });
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const aExt = a.name.split(".").pop()?.toLowerCase() ?? "";
    const bExt = b.name.split(".").pop()?.toLowerCase() ?? "";
    return MEDIA_PREFERENCE.indexOf(aExt) - MEDIA_PREFERENCE.indexOf(bExt);
  });
  return candidates[0];
}

async function runFullExportImport(
  zip: JSZip,
  manifestEntry: JSZip.JSZipObject,
  creds: GongCredentials,
  overrides: MapperOverrides | undefined
) {
  let manifest: ManifestRow[];
  try {
    const text = await manifestEntry.async("string");
    manifest = JSON.parse(text) as ManifestRow[];
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: `Failed to parse manifest.json: ${message}` }, { status: 400 });
  }
  if (!Array.isArray(manifest)) {
    return Response.json({ error: "manifest.json must be an array" }, { status: 400 });
  }

  // Manifest may live at the top of a single wrapper folder. Compute its dir prefix.
  const manifestPath = manifestEntry.name;
  const manifestPrefix = manifestPath.includes("/")
    ? manifestPath.slice(0, manifestPath.lastIndexOf("/") + 1)
    : "";

  const rows: BulkImportRow[] = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of manifest) {
    if (!row.folder) {
      rows.push({
        folder: "(missing folder)",
        status: "error",
        error: "Manifest row has no folder",
      });
      failed++;
      continue;
    }
    if (row.media_included === false) {
      rows.push({
        folder: row.folder,
        status: "skipped",
        title: row.title,
        error: "media_included=false in manifest",
      });
      skipped++;
      continue;
    }

    const result = await importOneFolder(zip, manifestPrefix + row.folder + "/", creds, overrides);
    if ("error" in result) {
      rows.push({
        folder: row.folder,
        status: "error",
        title: row.title,
        error: result.error,
      });
      failed++;
    } else {
      rows.push({
        folder: row.folder,
        status: "ok",
        title: row.title,
        callId: result.callId,
        gongUrl: result.gongUrl,
      });
      succeeded++;
    }
  }

  const out: BulkImportResult = {
    summary: { total: manifest.length, succeeded, failed, skipped },
    rows,
  };
  return Response.json(out);
}

async function importOneFolder(
  zip: JSZip,
  dirPrefix: string,
  creds: GongCredentials,
  overrides: MapperOverrides | undefined
): Promise<{ callId: string; gongUrl?: string } | { error: string }> {
  // Find metadata.json under dirPrefix.
  let metadataEntry: JSZip.JSZipObject | null = null;
  zip.forEach((path, entry) => {
    if (entry.dir) return;
    if (!path.startsWith(dirPrefix)) return;
    if (path.split("/").pop()?.toLowerCase() === "metadata.json") {
      if (!metadataEntry) metadataEntry = entry;
    }
  });
  if (!metadataEntry) return { error: `metadata.json not found in ${dirPrefix}` };

  let raw: RawGongExport;
  try {
    raw = JSON.parse(await (metadataEntry as JSZip.JSZipObject).async("string")) as RawGongExport;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { error: `Invalid metadata.json: ${message}` };
  }

  const recording = pickRecordingFromDir(zip, dirPrefix);
  if (!recording) return { error: `No recording found in ${dirPrefix}` };

  const media = await recording.async("arraybuffer");
  if (media.byteLength > MAX_FILE_SIZE) {
    return { error: `Recording exceeds 1.5 GB limit (${dirPrefix})` };
  }
  const ext = recording.name.split(".").pop()?.toLowerCase() ?? "";
  const contentType = CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream";

  const metadata = mapExportToImportMetadata(raw, overrides);
  if (!metadata.primaryUser) {
    return { error: "metadata.json is missing primaryUserId" };
  }

  const result = await importCall(creds, metadata, { buffer: media, contentType });
  if (result.error || !result.data) {
    return { error: result.error ?? "Unknown import error" };
  }
  return { callId: result.data.callId, gongUrl: result.data.gongUrl };
}
