import "server-only";
import type {
  ApiResult,
  NormalizedCall,
  NormalizedCallsResponse,
  NormalizedParty,
  SalesLoftConversation,
  SalesLoftCredentials,
  SalesLoftExtensiveConversation,
  SalesLoftListResponse,
  SalesLoftParticipant,
  SalesLoftTranscriptionSentence,
  SalesLoftTranscriptionSentencesResponse,
} from "./types";

const BASE_URL = "https://api.salesloft.com";

function authHeader(creds: SalesLoftCredentials): string {
  return `Bearer ${creds.apiKey}`;
}

function parseRateLimit(resp: Response): number | undefined {
  const raw = resp.headers.get("x-ratelimit-remaining");
  return raw ? Number(raw) : undefined;
}

async function handleError(
  resp: Response,
  rateLimitRemaining?: number
): Promise<{ error: string; rateLimitRemaining?: number }> {
  if (resp.status === 401) {
    return { error: "Invalid credentials. Check your SalesLoft API Key.", rateLimitRemaining };
  }
  if (resp.status === 403) {
    return {
      error: "Forbidden. Your key may lack the 'conversations:read' scope or Conversations access.",
      rateLimitRemaining,
    };
  }
  if (resp.status === 429) {
    const retryAfter = resp.headers.get("Retry-After");
    return {
      error: `rate-limited:${retryAfter ?? "60"}`,
      rateLimitRemaining: 0,
    };
  }
  const body = await resp.text().catch(() => "");
  return {
    error: `SalesLoft API error (${resp.status})${body ? `: ${body.slice(0, 200)}` : ""}`,
    rateLimitRemaining,
  };
}

export async function fetchConversations(
  creds: SalesLoftCredentials,
  options?: {
    page?: number;
    perPage?: number;
    fromDate?: string;
    toDate?: string;
  }
): Promise<ApiResult<NormalizedCallsResponse>> {
  const params = new URLSearchParams();
  params.set("per_page", String(options?.perPage ?? 25));
  params.set("page", String(options?.page ?? 1));
  params.set("sort_by", "created_at");
  params.set("sort_direction", "desc");
  if (options?.fromDate) params.set("created_at[gt]", options.fromDate);
  if (options?.toDate) params.set("created_at[lt]", options.toDate);

  try {
    const resp = await fetch(`${BASE_URL}/v2/conversations?${params}`, {
      method: "GET",
      headers: { Authorization: authHeader(creds), Accept: "application/json" },
    });

    const rateLimitRemaining = parseRateLimit(resp);
    if (!resp.ok) return await handleError(resp, rateLimitRemaining);

    const body = (await resp.json()) as SalesLoftListResponse<SalesLoftConversation>;
    const calls = (body.data ?? []).map(toNormalizedCall);
    const paging = body.metadata?.paging;
    const nextPage = paging?.next_page;

    return {
      data: {
        calls,
        cursor: nextPage ? String(nextPage) : undefined,
      },
      rateLimitRemaining,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { error: `Network error: ${message}` };
  }
}

export async function fetchConversationById(
  creds: SalesLoftCredentials,
  id: string
): Promise<ApiResult<NormalizedCall>> {
  try {
    // /extensive includes AI features (Summary, Action Items, Key Moments) when available.
    const resp = await fetch(`${BASE_URL}/v2/conversations/${encodeURIComponent(id)}/extensive`, {
      method: "GET",
      headers: { Authorization: authHeader(creds), Accept: "application/json" },
    });

    const rateLimitRemaining = parseRateLimit(resp);
    if (!resp.ok) {
      // Fall back to the non-extensive endpoint if /extensive is not available for this tenant.
      if (resp.status === 404) {
        return fetchConversationByIdBasic(creds, id);
      }
      return await handleError(resp, rateLimitRemaining);
    }

    const body = (await resp.json()) as { data: SalesLoftConversation };
    if (!body.data) return { error: "Conversation not found", rateLimitRemaining };
    return { data: toNormalizedCall(body.data), rateLimitRemaining };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { error: `Network error: ${message}` };
  }
}

export async function fetchConversationExtensive(
  creds: SalesLoftCredentials,
  id: string
): Promise<ApiResult<SalesLoftExtensiveConversation>> {
  try {
    const resp = await fetch(
      `${BASE_URL}/v2/conversations/${encodeURIComponent(id)}/extensive`,
      {
        method: "GET",
        headers: { Authorization: authHeader(creds), Accept: "application/json" },
      }
    );
    const rateLimitRemaining = parseRateLimit(resp);
    if (resp.status === 429) {
      const retryAfter = resp.headers.get("Retry-After");
      return { error: `rate-limited:${retryAfter ?? "60"}`, rateLimitRemaining: 0 };
    }
    if (!resp.ok) return await handleError(resp, rateLimitRemaining);
    const body = (await resp.json()) as { data: SalesLoftExtensiveConversation };
    if (!body.data) return { error: "Conversation not found", rateLimitRemaining };
    return { data: body.data, rateLimitRemaining };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { error: `Network error: ${message}` };
  }
}

export async function fetchTranscriptionSentences(
  creds: SalesLoftCredentials,
  transcriptionId: string
): Promise<ApiResult<SalesLoftTranscriptionSentence[]>> {
  try {
    const resp = await fetch(
      `${BASE_URL}/v2/transcriptions/${encodeURIComponent(transcriptionId)}/sentences?per_page=100`,
      {
        method: "GET",
        headers: { Authorization: authHeader(creds), Accept: "application/json" },
      }
    );
    const rateLimitRemaining = parseRateLimit(resp);
    if (resp.status === 429) {
      const retryAfter = resp.headers.get("Retry-After");
      return { error: `rate-limited:${retryAfter ?? "60"}`, rateLimitRemaining: 0 };
    }
    if (!resp.ok) return await handleError(resp, rateLimitRemaining);
    const body = (await resp.json()) as SalesLoftTranscriptionSentencesResponse;
    return { data: body.data ?? [], rateLimitRemaining };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { error: `Network error: ${message}` };
  }
}

async function fetchConversationByIdBasic(
  creds: SalesLoftCredentials,
  id: string
): Promise<ApiResult<NormalizedCall>> {
  try {
    const resp = await fetch(`${BASE_URL}/v2/conversations/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: { Authorization: authHeader(creds), Accept: "application/json" },
    });
    const rateLimitRemaining = parseRateLimit(resp);
    if (!resp.ok) return await handleError(resp, rateLimitRemaining);
    const body = (await resp.json()) as { data: SalesLoftConversation };
    if (!body.data) return { error: "Conversation not found", rateLimitRemaining };
    return { data: toNormalizedCall(body.data), rateLimitRemaining };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { error: `Network error: ${message}` };
  }
}

export async function fetchConversationRecordingUrl(
  creds: SalesLoftCredentials,
  id: string
): Promise<ApiResult<{ url: string }>> {
  try {
    const resp = await fetch(`${BASE_URL}/v2/conversations/${encodeURIComponent(id)}/recording`, {
      method: "GET",
      headers: { Authorization: authHeader(creds), Accept: "application/json" },
      redirect: "manual",
    });
    const rateLimitRemaining = parseRateLimit(resp);

    // Some tenants return a redirect to the signed media URL.
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      if (location) return { data: { url: location }, rateLimitRemaining };
    }

    if (!resp.ok) return await handleError(resp, rateLimitRemaining);

    // Otherwise expect JSON with a url field.
    const body = (await resp.json()) as {
      data?: { url?: string; recording_url?: string } | null;
      url?: string;
      recording_url?: string;
    };
    const url =
      body.data?.url ??
      body.data?.recording_url ??
      body.url ??
      body.recording_url;
    if (!url) return { error: "No recording URL available", rateLimitRemaining };
    return { data: { url }, rateLimitRemaining };
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
    if (!resp.ok) return { error: `Media fetch failed (${resp.status}): ${resp.statusText}` };
    if (!resp.body) return { error: "No response body from media URL." };
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

function inferAffiliation(p: SalesLoftParticipant, ownerEmail?: string): "Internal" | "External" | "Unknown" {
  if (p.role === "rep" || p.role === "user" || p.role === "host") return "Internal";
  if (p.role === "prospect" || p.role === "customer" || p.role === "contact") return "External";
  if (ownerEmail && p.email && p.email.toLowerCase() === ownerEmail.toLowerCase()) return "Internal";
  if (ownerEmail && p.email) {
    const ownerDomain = ownerEmail.split("@")[1]?.toLowerCase();
    const partyDomain = p.email.split("@")[1]?.toLowerCase();
    if (ownerDomain && partyDomain) {
      return ownerDomain === partyDomain ? "Internal" : "External";
    }
  }
  return "Unknown";
}

export function toNormalizedCall(c: SalesLoftConversation): NormalizedCall {
  const ownerEmail = c.user?.email;
  const parties: NormalizedParty[] = (c.participants ?? []).map((p) => ({
    name: p.name,
    email: p.email,
    title: p.role,
    affiliation: inferAffiliation(p, ownerEmail),
  }));

  // Include the call owner as an internal party if not already present.
  if (c.user && !parties.some((p) => p.email && c.user?.email && p.email.toLowerCase() === c.user.email.toLowerCase())) {
    parties.unshift({
      name: c.user.name,
      email: c.user.email,
      affiliation: "Internal",
    });
  }

  const started = c.started_at ?? c.created_at ?? new Date().toISOString();

  return {
    provider: "salesloft",
    id: String(c.id),
    title: c.title ?? c.subject ?? `Conversation ${c.id}`,
    started,
    durationSec: c.duration ?? 0,
    direction: c.direction,
    system: "SalesLoft",
    scope: c.call_type,
    media: "Audio",
    url: undefined,
    audioUrl: c.recording_url,
    parties,
    summary: c.summary,
    outcome: c.call_disposition,
    raw: c,
  };
}
