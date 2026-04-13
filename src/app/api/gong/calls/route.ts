import { NextRequest } from "next/server";
import { fetchCalls } from "@/lib/gong-client";
import type { GongCredentials } from "@/lib/types";

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    credentials?: GongCredentials;
    cursor?: string;
    fromDate?: string;
    toDate?: string;
  };

  if (!body.credentials?.accessKey || !body.credentials?.accessKeySecret || !body.credentials?.baseUrl) {
    return Response.json({ error: "Missing credentials" }, { status: 400 });
  }

  const result = await fetchCalls(body.credentials, {
    cursor: body.cursor,
    fromDate: body.fromDate,
    toDate: body.toDate,
  });

  if (result.error) {
    return Response.json(
      { error: result.error },
      { status: 502, headers: rateLimitHeaders(result.rateLimitRemaining) }
    );
  }

  return Response.json(result.data, {
    headers: rateLimitHeaders(result.rateLimitRemaining),
  });
}

function rateLimitHeaders(remaining?: number): Record<string, string> {
  if (remaining === undefined) return {};
  return { "X-Gong-RateLimit-Remaining": String(remaining) };
}
