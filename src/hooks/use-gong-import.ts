"use client";

import { useState, useEffect, useCallback } from "react";
import { upload } from "@vercel/blob/client";
import { useCredentials } from "@/components/credential-provider";
import type {
  GongWorkspace,
  ImportCallMetadata,
  ImportResult,
  BulkImportResult,
} from "@/lib/types";

export type ImportStatus = "idle" | "uploading" | "success" | "error";

export interface ZipOverrides {
  workspaceId?: string;
  title?: string;
  primaryUser?: string;
}

interface ImportState {
  status: ImportStatus;
  error: string;
  result: ImportResult | null;
  bulk: BulkImportResult | null;
  progress: string;
}

export function useGongImport() {
  const { credentials } = useCredentials();

  const [workspaces, setWorkspaces] = useState<GongWorkspace[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [workspacesError, setWorkspacesError] = useState("");

  const [importState, setImportState] = useState<ImportState>({
    status: "idle",
    error: "",
    result: null,
    bulk: null,
    progress: "",
  });

  const fetchWorkspaces = useCallback(async () => {
    if (!credentials || credentials.provider !== "gong") return;

    setWorkspacesLoading(true);
    setWorkspacesError("");

    try {
      const resp = await fetch("/api/gong/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials }),
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setWorkspacesError(
          (body as { error?: string }).error ?? `Failed to fetch workspaces (${resp.status})`
        );
        return;
      }

      const data = (await resp.json()) as { workspaces: GongWorkspace[] };
      setWorkspaces(data.workspaces ?? []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setWorkspacesError(`Network error: ${message}`);
    } finally {
      setWorkspacesLoading(false);
    }
  }, [credentials]);

  useEffect(() => {
    if (credentials?.provider === "gong") {
      fetchWorkspaces();
    }
  }, [credentials, fetchWorkspaces]);

  async function importManual(
    file: File,
    metadata: ImportCallMetadata
  ): Promise<void> {
    if (!credentials || credentials.provider !== "gong") return;

    setImportState({
      status: "uploading",
      error: "",
      result: null,
      bulk: null,
      progress: "Uploading file...",
    });

    try {
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/gong/blob-upload-token",
      });

      setImportState((prev) => ({ ...prev, progress: "Creating call in Gong..." }));

      const resp = await fetch("/api/gong/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "manual",
          credentials,
          metadata,
          blobUrl: blob.url,
          contentType: file.type || "application/octet-stream",
        }),
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        const error = (body as { error?: string }).error ?? `Import failed (${resp.status})`;
        setImportState({ status: "error", error, result: null, bulk: null, progress: "" });
        return;
      }

      const result = (await resp.json()) as ImportResult;
      setImportState({ status: "success", error: "", result, bulk: null, progress: "" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setImportState({
        status: "error",
        error: `Upload error: ${message}`,
        result: null,
        bulk: null,
        progress: "",
      });
    }
  }

  async function importAutomatic(
    sourceUrl: string,
    metadata: ImportCallMetadata
  ): Promise<void> {
    if (!credentials || credentials.provider !== "gong") return;

    setImportState({
      status: "uploading",
      error: "",
      result: null,
      bulk: null,
      progress: "Fetching media from URL...",
    });

    try {
      const resp = await fetch("/api/gong/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials, metadata, sourceUrl }),
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        const error = (body as { error?: string }).error ?? `Import failed (${resp.status})`;
        setImportState({ status: "error", error, result: null, bulk: null, progress: "" });
        return;
      }

      const result = (await resp.json()) as ImportResult;
      setImportState({ status: "success", error: "", result, bulk: null, progress: "" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setImportState({
        status: "error",
        error: `Network error: ${message}`,
        result: null,
        bulk: null,
        progress: "",
      });
    }
  }

  async function importZip(file: File, overrides?: ZipOverrides): Promise<void> {
    if (!credentials || credentials.provider !== "gong") return;

    setImportState({
      status: "uploading",
      error: "",
      result: null,
      bulk: null,
      progress: "Uploading ZIP...",
    });

    try {
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/gong/blob-upload-token",
      });

      setImportState((prev) => ({ ...prev, progress: "Importing calls into Gong..." }));

      const resp = await fetch("/api/gong/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "zip",
          credentials,
          blobUrl: blob.url,
          overrides,
        }),
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        const error = (body as { error?: string }).error ?? `Import failed (${resp.status})`;
        setImportState({ status: "error", error, result: null, bulk: null, progress: "" });
        return;
      }

      const data = (await resp.json()) as ImportResult | BulkImportResult;
      if ("rows" in data) {
        setImportState({
          status: "success",
          error: "",
          result: null,
          bulk: data,
          progress: "",
        });
      } else {
        setImportState({
          status: "success",
          error: "",
          result: data,
          bulk: null,
          progress: "",
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setImportState({
        status: "error",
        error: `Upload error: ${message}`,
        result: null,
        bulk: null,
        progress: "",
      });
    }
  }

  function resetImport() {
    setImportState({ status: "idle", error: "", result: null, bulk: null, progress: "" });
  }

  return {
    workspaces,
    workspacesLoading,
    workspacesError,
    importState,
    importManual,
    importAutomatic,
    importZip,
    resetImport,
    refetchWorkspaces: fetchWorkspaces,
  };
}
