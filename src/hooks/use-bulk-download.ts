"use client";

import { useState, useCallback, useRef } from "react";
import { zipSync } from "fflate";
import type { GongCall } from "@/lib/types";

export type MediaType = "audio" | "video" | "both";

export type DownloadStatus = "idle" | "downloading" | "complete" | "cancelled";

export interface DownloadFailure {
  callId: string;
  callTitle: string;
  mediaType: string;
  error: string;
}

export interface BulkDownloadState {
  status: DownloadStatus;
  current: number;
  total: number;
  currentFile: string;
  failures: DownloadFailure[];
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100)
    .toLowerCase();
}

function formatDateForFilename(iso: string): string {
  return new Date(iso).toISOString().split("T")[0];
}

function buildFilePaths(
  calls: GongCall[],
  mediaType: MediaType
): Array<{ call: GongCall; folder: string; files: Array<{ url: string; filename: string }> }> {
  const folderCounts = new Map<string, number>();

  return calls.map((call) => {
    const title = call.metaData.title || "untitled-call";
    const date = formatDateForFilename(call.metaData.started);
    const baseName = sanitizeFilename(title);
    let folder = `${baseName}-${date}`;

    const count = folderCounts.get(folder) ?? 0;
    folderCounts.set(folder, count + 1);
    if (count > 0) {
      folder = `${folder}-${count + 1}`;
    }

    const files: Array<{ url: string; filename: string }> = [];

    if ((mediaType === "audio" || mediaType === "both") && call.media?.audioUrl) {
      files.push({ url: call.media.audioUrl, filename: `${baseName}-${date}.mp3` });
    }
    if ((mediaType === "video" || mediaType === "both") && call.media?.videoUrl) {
      files.push({ url: call.media.videoUrl, filename: `${baseName}-${date}.mp4` });
    }

    return { call, folder, files };
  });
}

async function fetchMediaAsBytes(
  url: string,
  filename: string,
  signal: AbortSignal
): Promise<Uint8Array> {
  const resp = await fetch("/api/gong/media", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mediaUrl: url, filename }),
    signal,
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Download failed (${resp.status})`);
  }

  const buffer = await resp.arrayBuffer();
  return new Uint8Array(buffer);
}

export function useBulkDownload() {
  const [state, setState] = useState<BulkDownloadState>({
    status: "idle",
    current: 0,
    total: 0,
    currentFile: "",
    failures: [],
  });

  const abortRef = useRef<AbortController | null>(null);

  const startDownload = useCallback(
    async (calls: GongCall[], mediaType: MediaType) => {
      const controller = new AbortController();
      abortRef.current = controller;

      const filePlan = buildFilePaths(calls, mediaType);
      const totalFiles = filePlan.reduce((sum, p) => sum + p.files.length, 0);

      if (totalFiles === 0) {
        setState({
          status: "complete",
          current: 0,
          total: 0,
          currentFile: "",
          failures: [{ callId: "", callTitle: "", mediaType: "", error: "No media files available for selected calls" }],
        });
        return;
      }

      setState({
        status: "downloading",
        current: 0,
        total: totalFiles,
        currentFile: "",
        failures: [],
      });

      const zipData: Record<string, Uint8Array> = {};
      const failures: DownloadFailure[] = [];
      let completed = 0;

      const exportDate = new Date().toISOString().split("T")[0];
      const rootFolder = `gong-export-${exportDate}`;

      // Process with concurrency limit of 3
      const queue = filePlan.flatMap((plan) =>
        plan.files.map((file) => ({
          call: plan.call,
          folder: plan.folder,
          ...file,
        }))
      );

      const concurrency = 3;
      let index = 0;

      async function processNext(): Promise<void> {
        while (index < queue.length) {
          if (controller.signal.aborted) return;

          const current = index++;
          const item = queue[current];

          setState((prev) => ({
            ...prev,
            current: completed + 1,
            currentFile: item.filename,
          }));

          try {
            const bytes = await fetchMediaAsBytes(item.url, item.filename, controller.signal);
            zipData[`${rootFolder}/${item.folder}/${item.filename}`] = bytes;
          } catch (err) {
            if (controller.signal.aborted) return;
            failures.push({
              callId: item.call.metaData.id,
              callTitle: item.call.metaData.title || "Untitled",
              mediaType: item.filename.endsWith(".mp4") ? "video" : "audio",
              error: err instanceof Error ? err.message : "Unknown error",
            });
          }

          completed++;
          setState((prev) => ({
            ...prev,
            current: completed,
            failures: [...failures],
          }));
        }
      }

      const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () =>
        processNext()
      );

      await Promise.all(workers);

      if (controller.signal.aborted) {
        setState((prev) => ({ ...prev, status: "cancelled" }));
        return;
      }

      // Build ZIP and trigger download
      if (Object.keys(zipData).length > 0) {
        const zipped = zipSync(zipData);
        const blob = new Blob([zipped.buffer as ArrayBuffer], { type: "application/zip" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${rootFolder}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      setState({
        status: "complete",
        current: completed,
        total: totalFiles,
        currentFile: "",
        failures,
      });
    },
    []
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    setState({
      status: "idle",
      current: 0,
      total: 0,
      currentFile: "",
      failures: [],
    });
  }, []);

  return { state, startDownload, cancel, reset };
}
