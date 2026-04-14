import { NextRequest } from "next/server";
import { fetchMediaStream } from "@/lib/gong-client";
import { assertPublicHttpsUrl } from "@/lib/url-guard";

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    mediaUrl?: string;
    filename?: string;
  };

  if (!body.mediaUrl) {
    return Response.json({ error: "Missing mediaUrl" }, { status: 400 });
  }

  const guard = assertPublicHttpsUrl(body.mediaUrl);
  if ("error" in guard) {
    return Response.json({ error: guard.error }, { status: 403 });
  }

  const result = await fetchMediaStream(body.mediaUrl);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 502 });
  }

  const filename = body.filename ?? "recording";
  const headers: Record<string, string> = {
    "Content-Type": result.contentType,
    "Content-Disposition": `attachment; filename="${filename}"`,
  };
  if (result.contentLength) {
    headers["Content-Length"] = result.contentLength;
  }

  return new Response(result.stream, { headers });
}
