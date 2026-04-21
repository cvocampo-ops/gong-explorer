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
