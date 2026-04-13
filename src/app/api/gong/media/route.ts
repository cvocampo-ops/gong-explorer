import { NextRequest } from "next/server";
import { fetchMediaStream } from "@/lib/gong-client";

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    mediaUrl?: string;
    filename?: string;
  };

  if (!body.mediaUrl) {
    return Response.json({ error: "Missing mediaUrl" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(body.mediaUrl);
  } catch {
    return Response.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (parsed.protocol !== "https:") {
    return Response.json({ error: "Only HTTPS URLs are allowed" }, { status: 403 });
  }

  const hostname = parsed.hostname.toLowerCase();
  const isPrivate =
    hostname === "localhost" ||
    hostname.startsWith("127.") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("169.254.") ||
    hostname.endsWith(".local") ||
    hostname.startsWith("0.");
  if (isPrivate) {
    return Response.json({ error: "Internal URLs are not allowed" }, { status: 403 });
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
