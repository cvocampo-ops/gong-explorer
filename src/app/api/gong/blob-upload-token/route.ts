import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest } from "next/server";

const ALLOWED_CONTENT_TYPES = [
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
  "video/mp4",
  "video/x-matroska",
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/flac",
];

const MAX_BLOB_SIZE = 1.5 * 1024 * 1024 * 1024; // 1.5 GB

export async function POST(request: NextRequest) {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ALLOWED_CONTENT_TYPES,
        maximumSizeInBytes: MAX_BLOB_SIZE,
        addRandomSuffix: true,
      }),
      onUploadCompleted: async () => {
        // No-op. The /api/gong/import route will fetch the blob and delete it.
      },
    });
    return Response.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 400 });
  }
}
