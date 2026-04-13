import "server-only";
import type {
  GongCredentials,
  GongCallsResponse,
  ApiResult,
} from "./types";

function buildAuthHeader(creds: GongCredentials): string {
  const encoded = Buffer.from(
    `${creds.accessKey}:${creds.accessKeySecret}`
  ).toString("base64");
  return `Basic ${encoded}`;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export async function fetchCalls(
  creds: GongCredentials,
  options?: {
    cursor?: string;
    fromDate?: string;
    toDate?: string;
  }
): Promise<ApiResult<GongCallsResponse>> {
  const baseUrl = normalizeBaseUrl(creds.baseUrl);
  const filter: Record<string, string> = {};
  if (options?.fromDate) filter.fromDateTime = options.fromDate;
  if (options?.toDate) filter.toDateTime = options.toDate;

  const payload: Record<string, unknown> = {
    filter,
    contentSelector: {
      exposedFields: {
        content: {
          brief: true,
          outline: true,
          highlights: true,
          callOutcome: true,
          topics: true,
          trackers: true,
        },
        collaboration: {
          publicComments: true,
        },
        interaction: {
          interactionStats: true,
          speakers: true,
          video: true,
          questions: true,
        },
        media: true,
        parties: true,
      },
    },
  };
  if (options?.cursor) payload.cursor = options.cursor;

  try {
    const resp = await fetch(`${baseUrl}/v2/calls/extensive`, {
      method: "POST",
      headers: {
        Authorization: buildAuthHeader(creds),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const rateLimitRemaining = resp.headers.get("X-RateLimit-Remaining")
      ? Number(resp.headers.get("X-RateLimit-Remaining"))
      : undefined;

    if (!resp.ok) {
      const body = await resp.text();
      if (resp.status === 401) {
        return { error: "Invalid credentials. Check your Access Key and Secret.", rateLimitRemaining };
      }
      if (resp.status === 429) {
        const retryAfter = resp.headers.get("Retry-After");
        return {
          error: `Rate limited. Try again in ${retryAfter ?? "a few"} seconds.`,
          rateLimitRemaining: 0,
        };
      }
      return { error: `Gong API error (${resp.status}): ${body}`, rateLimitRemaining };
    }

    const data = (await resp.json()) as GongCallsResponse;
    return { data, rateLimitRemaining };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { error: `Network error: ${message}` };
  }
}

export async function fetchCallById(
  creds: GongCredentials,
  callId: string
): Promise<ApiResult<GongCallsResponse>> {
  const baseUrl = normalizeBaseUrl(creds.baseUrl);

  const payload = {
    filter: { callIds: [callId] },
    contentSelector: {
      exposedFields: {
        content: {
          brief: true,
          outline: true,
          highlights: true,
          callOutcome: true,
          topics: true,
          trackers: true,
        },
        collaboration: {
          publicComments: true,
        },
        interaction: {
          interactionStats: true,
          speakers: true,
          video: true,
          questions: true,
        },
        media: true,
        parties: true,
      },
    },
  };

  try {
    const resp = await fetch(`${baseUrl}/v2/calls/extensive`, {
      method: "POST",
      headers: {
        Authorization: buildAuthHeader(creds),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const rateLimitRemaining = resp.headers.get("X-RateLimit-Remaining")
      ? Number(resp.headers.get("X-RateLimit-Remaining"))
      : undefined;

    if (!resp.ok) {
      const body = await resp.text();
      return { error: `Gong API error (${resp.status}): ${body}`, rateLimitRemaining };
    }

    const data = (await resp.json()) as GongCallsResponse;
    return { data, rateLimitRemaining };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { error: `Network error: ${message}` };
  }
}

export async function fetchMediaStream(
  mediaUrl: string
): Promise<{ stream: ReadableStream; contentType: string; contentLength: string | null } | { error: string }> {
  try {
    const resp = await fetch(mediaUrl);
    if (!resp.ok) {
      return { error: `Media fetch failed (${resp.status}): ${resp.statusText}` };
    }
    if (!resp.body) {
      return { error: "No response body from media URL." };
    }

    return {
      stream: resp.body,
      contentType: resp.headers.get("Content-Type") ?? "application/octet-stream",
      contentLength: resp.headers.get("Content-Length"),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { error: `Media download error: ${message}` };
  }
}
