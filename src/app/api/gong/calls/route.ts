import { NextRequest } from "next/server";
import { fetchCalls } from "@/lib/gong-client";
import { gongToNormalized } from "@/lib/gong-normalize";
import type { GongCredentials, NormalizedCallsResponse } from "@/lib/types";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    credentials?: { provider?: string } & GongCredentials;
    cursor?: string;
    fromDate?: string;
    toDate?: string;
  };

  if (!body.credentials?.accessKey || !body.credentials?.accessKeySecret || !body.credentials?.baseUrl) {
    return Response.json({ error: "Missing credentials" }, { status: 400 });
  }

  const creds: GongCredentials = {
    accessKey: body.credentials.accessKey,
    accessKeySecret: body.credentials.accessKeySecret,
    baseUrl: body.credentials.baseUrl,
  };

  const result = await fetchCalls(creds, {
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

  const normalized: NormalizedCallsResponse = {
    calls: (result.data?.calls ?? []).map(gongToNormalized),
    cursor: result.data?.records.cursor,
    totalRecords: result.data?.records.totalRecords,
  };

  return Response.json(normalized, {
    headers: rateLimitHeaders(result.rateLimitRemaining),
  });
}

function rateLimitHeaders(remaining?: number): Record<string, string> {
  if (remaining === undefined) return {};
  return { "X-RateLimit-Remaining": String(remaining) };
}
