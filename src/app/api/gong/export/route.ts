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
  if (!creds) {
    return { error: "Missing credentials" };
  }
  if (creds.provider !== "gong") {
    return { error: "Export is only supported for Gong provider right now" };
  }
  if (
    typeof creds.accessKey !== "string" ||
    typeof creds.accessKeySecret !== "string" ||
    typeof creds.baseUrl !== "string"
  ) {
    return { error: "Invalid Gong credentials" };
  }

  const options = p.options as Record<string, unknown> | undefined;
  if (!options || typeof options.includeMedia !== "boolean" || typeof options.includeTranscripts !== "boolean") {
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

  if (!callIds && !filter) {
    return { error: "Provide either callIds or filter" };
  }

  return {
    credentials: {
      provider: "gong",
      accessKey: creds.accessKey,
      accessKeySecret: creds.accessKeySecret,
      baseUrl: creds.baseUrl,
    },
    callIds: callIds as string[] | undefined,
    filter: filter as ExportRequestPayload["filter"],
    options: {
      includeMedia: options.includeMedia,
      mediaType: options.mediaType as "audio" | "video" | "both" | undefined,
      includeMetadata: options.includeMetadata !== false,
      includeTranscripts: options.includeTranscripts,
    },
  };
}

async function extractPayload(request: NextRequest): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const raw = form.get("payload");
    if (typeof raw !== "string") return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const payload = await extractPayload(request);
  const parsed = validate(payload);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  // Provider is narrowed to "gong" by validate(); pass the Gong-native shape to the zipper.
  if (parsed.credentials.provider !== "gong") {
    return Response.json({ error: "Export is only supported for Gong" }, { status: 400 });
  }
  const nodeStream = streamExportZip({
    credentials: {
      accessKey: parsed.credentials.accessKey,
      accessKeySecret: parsed.credentials.accessKeySecret,
      baseUrl: parsed.credentials.baseUrl,
    },
    callIds: parsed.callIds,
    filter: parsed.filter,
    options: parsed.options,
  });
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;

  const filename = `gong-export-${timestamp()}.zip`;

  return new Response(webStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
