"use client";

import { useCredentials } from "@/components/credential-provider";
import { gongToNormalized } from "@/lib/gong-normalize";
import type {
  GongCall,
  GongCallsResponse,
  NormalizedCall,
  NormalizedCallsResponse,
} from "@/lib/types";

export function useCallApi() {
  const { credentials } = useCredentials();
  const provider = credentials?.provider;

  async function fetchCalls(options?: {
    cursor?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<{ data?: NormalizedCallsResponse; error?: string; rateLimitRemaining?: number }> {
    if (!credentials || !provider) return { error: "Not connected" };

    const resp = await fetch(`/api/${provider}/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        credentials,
        cursor: options?.cursor,
        fromDate: options?.fromDate,
        toDate: options?.toDate,
      }),
    });

    const rateLimitRemaining = resp.headers.get("X-RateLimit-Remaining")
      ? Number(resp.headers.get("X-RateLimit-Remaining"))
      : undefined;

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      return {
        error: (body as { error?: string }).error ?? `Request failed (${resp.status})`,
        rateLimitRemaining,
      };
    }

    if (provider === "gong") {
      const data = (await resp.json()) as GongCallsResponse;
      return {
        data: {
          calls: data.calls.map(gongToNormalized),
          cursor: data.records?.cursor,
          totalRecords: data.records?.totalRecords,
        },
        rateLimitRemaining,
      };
    }

    // SalesLoft routes already return NormalizedCallsResponse.
    const data = (await resp.json()) as NormalizedCallsResponse;
    return { data, rateLimitRemaining };
  }

  async function fetchCallDetail(id: string): Promise<{ data?: NormalizedCall; error?: string }> {
    if (!credentials || !provider) return { error: "Not connected" };

    const resp = await fetch(`/api/${provider}/calls/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credentials }),
    });

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      return { error: (body as { error?: string }).error ?? `Request failed (${resp.status})` };
    }

    if (provider === "gong") {
      const call = (await resp.json()) as GongCall;
      return { data: gongToNormalized(call) };
    }

    const call = (await resp.json()) as NormalizedCall;
    return { data: call };
  }

  async function downloadMedia(mediaUrl: string, filename: string): Promise<{ error?: string }> {
    if (!credentials) return { error: "Not connected" };

    const resp = await fetch("/api/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaUrl, filename }),
    });

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      return { error: (body as { error?: string }).error ?? `Download failed (${resp.status})` };
    }

    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return {};
  }

  async function fetchAllCalls(
    fromDate: string,
    toDate: string,
    options?: {
      signal?: AbortSignal;
      onProgress?: (loaded: number, total: number | null) => void;
    }
  ): Promise<{ data?: NormalizedCall[]; error?: string }> {
    if (!credentials || !provider) return { error: "Not connected" };

    const all: NormalizedCall[] = [];
    let cursor: string | undefined;
    let total: number | null = null;

    do {
      if (options?.signal?.aborted) break;

      const page = await fetchCalls({ cursor, fromDate, toDate });
      if (page.error) return { error: page.error };
      if (!page.data) break;

      all.push(...page.data.calls);
      if (total === null && page.data.totalRecords !== undefined) {
        total = page.data.totalRecords;
      }
      options?.onProgress?.(all.length, total);
      cursor = page.data.cursor;
    } while (cursor);

    return { data: all };
  }

  return { fetchCalls, fetchCallDetail, downloadMedia, fetchAllCalls };
}
