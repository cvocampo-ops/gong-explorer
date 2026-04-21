"use client";

import { useState, useEffect, useCallback } from "react";
import { useCredentials } from "@/components/credential-provider";
import type { GongWorkspace, ImportCallMetadata, ImportResult } from "@/lib/types";

export type ImportStatus = "idle" | "uploading" | "success" | "error";

interface ImportState {
  status: ImportStatus;
  error: string;
  result: ImportResult | null;
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

    setImportState({ status: "uploading", error: "", result: null, progress: "Creating call record..." });

    try {
      const formData = new FormData();
      formData.append("credentials", JSON.stringify(credentials));
      formData.append("metadata", JSON.stringify(metadata));
      formData.append("file", file);

      setImportState((prev) => ({ ...prev, progress: "Uploading media to Gong..." }));

      const resp = await fetch("/api/gong/import", {
        method: "POST",
        body: formData,
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        const error = (body as { error?: string }).error ?? `Import failed (${resp.status})`;
        setImportState({ status: "error", error, result: null, progress: "" });
        return;
      }

      const result = (await resp.json()) as ImportResult;
      setImportState({ status: "success", error: "", result, progress: "" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setImportState({ status: "error", error: `Network error: ${message}`, result: null, progress: "" });
    }
  }

  async function importAutomatic(
    sourceUrl: string,
    metadata: ImportCallMetadata
  ): Promise<void> {
    if (!credentials || credentials.provider !== "gong") return;

    setImportState({ status: "uploading", error: "", result: null, progress: "Fetching media from URL..." });

    try {
      const resp = await fetch("/api/gong/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials, metadata, sourceUrl }),
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        const error = (body as { error?: string }).error ?? `Import failed (${resp.status})`;
        setImportState({ status: "error", error, result: null, progress: "" });
        return;
      }

      const result = (await resp.json()) as ImportResult;
      setImportState({ status: "success", error: "", result, progress: "" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setImportState({ status: "error", error: `Network error: ${message}`, result: null, progress: "" });
    }
  }

  function resetImport() {
    setImportState({ status: "idle", error: "", result: null, progress: "" });
  }

  return {
    workspaces,
    workspacesLoading,
    workspacesError,
    importState,
    importManual,
    importAutomatic,
    resetImport,
    refetchWorkspaces: fetchWorkspaces,
  };
}
