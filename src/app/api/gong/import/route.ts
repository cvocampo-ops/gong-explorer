import { NextRequest } from "next/server";
import { importCall } from "@/lib/gong-client";
import type { GongCredentials, ImportCallMetadata } from "@/lib/types";

const ALLOWED_MEDIA_TYPES = new Set([
  "video/mp4",
  "video/x-matroska",
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/flac",
  "application/octet-stream",
]);

const MAX_FILE_SIZE = 1.5 * 1024 * 1024 * 1024; // 1.5 GB

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";

  // --- Manual mode: multipart/form-data ---
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();

    const credentialsRaw = formData.get("credentials");
    const metadataRaw = formData.get("metadata");
    const file = formData.get("file");

    if (!credentialsRaw || !metadataRaw) {
      return Response.json(
        { error: "Missing credentials or metadata in form data" },
        { status: 400 }
      );
    }

    if (!file || !(file instanceof File)) {
      return Response.json(
        { error: "Missing media file" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return Response.json(
        { error: "File exceeds maximum size of 1.5 GB" },
        { status: 400 }
      );
    }

    const fileType = file.type || "application/octet-stream";
    if (!ALLOWED_MEDIA_TYPES.has(fileType)) {
      return Response.json(
        { error: `Unsupported file type: ${fileType}. Supported: WAV, MP3, MP4, MKV, FLAC` },
        { status: 400 }
      );
    }

    let credentials: { provider?: string } & GongCredentials;
    let metadata: ImportCallMetadata;
    try {
      credentials = JSON.parse(credentialsRaw as string);
      metadata = JSON.parse(metadataRaw as string);
    } catch {
      return Response.json(
        { error: "Invalid JSON in credentials or metadata" },
        { status: 400 }
      );
    }

    if (!credentials.accessKey || !credentials.accessKeySecret || !credentials.baseUrl) {
      return Response.json({ error: "Missing credentials" }, { status: 400 });
    }

    const creds: GongCredentials = {
      accessKey: credentials.accessKey,
      accessKeySecret: credentials.accessKeySecret,
      baseUrl: credentials.baseUrl,
    };

    const buffer = await file.arrayBuffer();
    const result = await importCall(creds, metadata, {
      buffer,
      contentType: fileType,
    });

    if (result.error) {
      return Response.json({ error: result.error }, { status: 502 });
    }

    return Response.json(result.data);
  }

  // --- Automatic mode: JSON body with sourceUrl ---
  const body = (await request.json()) as {
    credentials?: { provider?: string } & GongCredentials;
    metadata?: ImportCallMetadata;
    sourceUrl?: string;
  };

  if (!body.credentials?.accessKey || !body.credentials?.accessKeySecret || !body.credentials?.baseUrl) {
    return Response.json({ error: "Missing credentials" }, { status: 400 });
  }

  if (!body.metadata) {
    return Response.json({ error: "Missing call metadata" }, { status: 400 });
  }

  if (!body.sourceUrl) {
    return Response.json(
      { error: "Missing sourceUrl for automatic import" },
      { status: 400 }
    );
  }

  const creds: GongCredentials = {
    accessKey: body.credentials.accessKey,
    accessKeySecret: body.credentials.accessKeySecret,
    baseUrl: body.credentials.baseUrl,
  };

  const result = await importCall(creds, body.metadata, {
    sourceUrl: body.sourceUrl,
  });

  if (result.error) {
    return Response.json({ error: result.error }, { status: 502 });
  }

  return Response.json(result.data);
}
