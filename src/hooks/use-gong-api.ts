"use client";

import { useCredentials } from "@/components/credential-provider";
import type { GongCall, GongCallsResponse } from "@/lib/types";

export function useGongApi() {
  const { credentials } = useCredentials();

  async function fetchCalls(options?: {
    cursor?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<{ data?: GongCallsResponse; error?: string; rateLimitRemaining?: number }> {
    if (!credentials) return { error: "Not connected" };

    const resp = await fetch("/api/gong/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        credentials,
        cursor: options?.cursor,
        fromDate: options?.fromDate,
        toDate: options?.toDate,
      }),
    });

    const rateLimitRemaining = resp.headers.get("X-Gong-RateLimit-Remaining")
      ? Number(resp.headers.get("X-Gong-RateLimit-Remaining"))
      : undefined;

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      return { error: (body as { error?: string }).error ?? `Request failed (${resp.status})`, rateLimitRemaining };
    }

    const data = (await resp.json()) as GongCallsResponse;
    return { data, rateLimitRemaining };
  }

  async function fetchCallDetail(id: string): Promise<{ data?: GongCall; error?: string }> {
    if (!credentials) return { error: "Not connected" };

    const resp = await fetch(`/api/gong/calls/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credentials }),
    });

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      return { error: (body as { error?: string }).error ?? `Request failed (${resp.status})` };
    }

    const data = (await resp.json()) as GongCall;
    return { data };
  }

  async function downloadMedia(mediaUrl: string, filename: string): Promise<{ error?: string }> {
    if (!credentials) return { error: "Not connected" };

    const resp = await fetch("/api/gong/media", {
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
