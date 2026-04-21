import "server-only";
import type {
  GongCredentials,
  GongCallsResponse,
  GongWorkspacesResponse,
  ImportCallMetadata,
  ImportResult,
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

export async function fetchCallsPage(
  creds: GongCredentials,
  options: {
    cursor?: string;
    fromDate?: string;
    toDate?: string;
    callIds?: string[];
  }
): Promise<ApiResult<GongCallsResponse>> {
  const baseUrl = normalizeBaseUrl(creds.baseUrl);
  const filter: Record<string, unknown> = {};
  if (options.fromDate) filter.fromDateTime = options.fromDate;
  if (options.toDate) filter.toDateTime = options.toDate;
  if (options.callIds && options.callIds.length > 0) filter.callIds = options.callIds;

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
  if (options.cursor) payload.cursor = options.cursor;

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

    if (resp.status === 429) {
      const retryAfter = resp.headers.get("Retry-After");
      return {
        error: `rate-limited:${retryAfter ?? "60"}`,
        rateLimitRemaining: 0,
      };
    }

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

export async function fetchTranscript(
  creds: GongCredentials,
  callId: string,
  fromDate?: string,
  toDate?: string
): Promise<ApiResult<{ callId: string; transcript: Array<{ speakerId?: string; topic?: string; sentences: Array<{ start: number; end: number; text: string }> }> }>> {
  const baseUrl = normalizeBaseUrl(creds.baseUrl);

  const filter: Record<string, unknown> = { callIds: [callId] };
  if (fromDate) filter.fromDateTime = fromDate;
  if (toDate) filter.toDateTime = toDate;

  try {
    const resp = await fetch(`${baseUrl}/v2/calls/transcript`, {
      method: "POST",
      headers: {
        Authorization: buildAuthHeader(creds),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filter }),
    });

    const rateLimitRemaining = resp.headers.get("X-RateLimit-Remaining")
      ? Number(resp.headers.get("X-RateLimit-Remaining"))
      : undefined;

    if (resp.status === 429) {
      const retryAfter = resp.headers.get("Retry-After");
      return { error: `rate-limited:${retryAfter ?? "60"}`, rateLimitRemaining: 0 };
    }

    if (!resp.ok) {
      const body = await resp.text();
      return { error: `Transcript error (${resp.status}): ${body}`, rateLimitRemaining };
    }

    const body = (await resp.json()) as { callTranscripts?: Array<{ callId: string; transcript: Array<{ speakerId?: string; topic?: string; sentences: Array<{ start: number; end: number; text: string }> }> }> };
    const first = body.callTranscripts?.[0];
    if (!first) {
      return { error: "No transcript available", rateLimitRemaining };
    }
    return { data: first, rateLimitRemaining };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { error: `Network error: ${message}` };
  }
}

export async function fetchWorkspaces(
  creds: GongCredentials
): Promise<ApiResult<GongWorkspacesResponse>> {
  const baseUrl = normalizeBaseUrl(creds.baseUrl);

  try {
    const resp = await fetch(`${baseUrl}/v2/workspaces`, {
      method: "GET",
      headers: {
        Authorization: buildAuthHeader(creds),
        "Content-Type": "application/json",
      },
    });

    const rateLimitRemaining = resp.headers.get("X-RateLimit-Remaining")
      ? Number(resp.headers.get("X-RateLimit-Remaining"))
      : undefined;

    if (!resp.ok) {
      const body = await resp.text();
      return { error: `Gong API error (${resp.status}): ${body}`, rateLimitRemaining };
    }

    const data = (await resp.json()) as GongWorkspacesResponse;
    return { data, rateLimitRemaining };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { error: `Network error: ${message}` };
  }
}

export async function createCall(
  creds: GongCredentials,
  metadata: ImportCallMetadata
): Promise<ApiResult<{ callId: string }>> {
  const baseUrl = normalizeBaseUrl(creds.baseUrl);

  const payload: Record<string, unknown> = {
    actualStart: metadata.actualStart,
    direction: metadata.direction,
    system: metadata.system ?? "API Upload",
    purpose: metadata.purpose ?? "Uploaded via Call Explorer",
    parties: metadata.parties.map((p) => ({
      ...(p.emailAddress && { emailAddress: p.emailAddress }),
      ...(p.name && { name: p.name }),
      ...(p.phoneNumber && { phoneNumber: p.phoneNumber }),
      ...(p.userId && { userId: p.userId }),
    })),
    primaryUser: metadata.primaryUser,
    clientUniqueId: metadata.clientUniqueId,
    ...(metadata.title && { title: metadata.title }),
    ...(metadata.workspaceId && { workspaceId: metadata.workspaceId }),
    ...(metadata.languageCode && { languageCode: metadata.languageCode }),
    ...(metadata.customData && { customData: metadata.customData }),
  };

  try {
    const resp = await fetch(`${baseUrl}/v2/calls`, {
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
      return { error: `Failed to create call (${resp.status}): ${body}`, rateLimitRemaining };
    }

    const data = (await resp.json()) as { callId: string; requestId: string };
    return { data: { callId: data.callId }, rateLimitRemaining };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { error: `Network error: ${message}` };
  }
}

export async function uploadMedia(
  creds: GongCredentials,
  callId: string,
  mediaBuffer: ArrayBuffer,
  contentType: string
): Promise<ApiResult<{ ok: true }>> {
  const baseUrl = normalizeBaseUrl(creds.baseUrl);

  try {
    const resp = await fetch(`${baseUrl}/v2/calls/${encodeURIComponent(callId)}/media`, {
      method: "PUT",
      headers: {
        Authorization: buildAuthHeader(creds),
        "Content-Type": contentType,
      },
      body: mediaBuffer,
    });

    const rateLimitRemaining = resp.headers.get("X-RateLimit-Remaining")
      ? Number(resp.headers.get("X-RateLimit-Remaining"))
      : undefined;

    if (!resp.ok) {
      const body = await resp.text();
      return { error: `Media upload failed (${resp.status}): ${body}`, rateLimitRemaining };
    }

    return { data: { ok: true }, rateLimitRemaining };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { error: `Network error: ${message}` };
  }
}

export async function importCall(
  creds: GongCredentials,
  metadata: ImportCallMetadata,
  media: { buffer: ArrayBuffer; contentType: string } | { sourceUrl: string }
): Promise<ApiResult<ImportResult>> {
  // Step 1: Create the call record
  const createResult = await createCall(creds, metadata);
  if (createResult.error || !createResult.data) {
    return { error: createResult.error ?? "Failed to create call", rateLimitRemaining: createResult.rateLimitRemaining };
  }

  const { callId } = createResult.data;

  // Step 2: Get the media bytes
  let buffer: ArrayBuffer;
  let contentType: string;

  if ("buffer" in media) {
    buffer = media.buffer;
    contentType = media.contentType;
  } else {
    try {
      const mediaResp = await fetch(media.sourceUrl);
      if (!mediaResp.ok) {
        return { error: `Failed to fetch media from URL (${mediaResp.status}): ${mediaResp.statusText}` };
      }
      buffer = await mediaResp.arrayBuffer();
      contentType = mediaResp.headers.get("Content-Type") ?? "application/octet-stream";
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return { error: `Failed to download media from URL: ${message}` };
    }
  }

  // Step 3: Upload media to the call
  const uploadResult = await uploadMedia(creds, callId, buffer, contentType);
  if (uploadResult.error) {
    return { error: uploadResult.error, rateLimitRemaining: uploadResult.rateLimitRemaining };
  }

  // Build the Gong URL for the call
  const baseHost = normalizeBaseUrl(creds.baseUrl)
    .replace("https://", "")
    .replace(".api.gong.io", ".app.gong.io");
  const gongUrl = `https://${baseHost}/call?id=${callId}`;

  return {
    data: { callId, gongUrl },
    rateLimitRemaining: uploadResult.rateLimitRemaining,
  };
}
