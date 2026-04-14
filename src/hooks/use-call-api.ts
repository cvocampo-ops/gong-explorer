"use client";

import { useCredentials } from "@/components/credential-provider";
import type { NormalizedCall, NormalizedCallsResponse } from "@/lib/types";

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

    const data = (await resp.json()) as NormalizedCall;
    return { data };
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

  return { fetchCalls, fetchCallDetail, downloadMedia };
}
