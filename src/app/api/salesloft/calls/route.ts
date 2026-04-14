import { NextRequest } from "next/server";
import { fetchConversations } from "@/lib/salesloft-client";
import type { SalesLoftCredentials } from "@/lib/types";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    credentials?: { provider?: string } & SalesLoftCredentials;
    cursor?: string;
    fromDate?: string;
    toDate?: string;
  };

  if (!body.credentials?.apiKey) {
    return Response.json({ error: "Missing credentials" }, { status: 400 });
  }

  const page = body.cursor ? Number(body.cursor) : 1;

  const result = await fetchConversations(
    { apiKey: body.credentials.apiKey },
    { page, fromDate: body.fromDate, toDate: body.toDate }
  );

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
  return { "X-RateLimit-Remaining": String(remaining) };
}
