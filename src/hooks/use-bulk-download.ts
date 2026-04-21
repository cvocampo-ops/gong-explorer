"use client";

import { useState, useCallback } from "react";
import { useCredentials } from "@/components/credential-provider";
import type { ExportRequestPayload } from "@/lib/types";

export type MediaType = "audio" | "video" | "both";

export type DownloadStatus = "idle" | "starting" | "complete" | "cancelled";

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

export interface BulkDownloadExtraOptions {
  includeMetadata?: boolean;
  includeTranscripts?: boolean;
}

export function useBulkDownload() {
  const { credentials } = useCredentials();
  const [state, setState] = useState<BulkDownloadState>({
    status: "idle",
    current: 0,
    total: 0,
    currentFile: "",
    failures: [],
  });

  const startDownload = useCallback(
    (
      calls: Array<{ id?: string; metaData?: { id: string } }>,
      mediaType: MediaType,
      extras?: BulkDownloadExtraOptions
    ) => {
      if (!credentials) {
        setState({
          status: "complete",
          current: 0,
          total: 0,
          currentFile: "",
          failures: [
            { callId: "", callTitle: "", mediaType: "", error: "Not connected" },
          ],
        });
        return;
      }

      if (calls.length === 0) {
        setState({
          status: "complete",
          current: 0,
          total: 0,
          currentFile: "",
          failures: [
            { callId: "", callTitle: "", mediaType: "", error: "No calls selected" },
          ],
        });
        return;
      }

      const callIds = calls
        .map((c) => c.id ?? c.metaData?.id)
        .filter((id): id is string => typeof id === "string");

      setState({
        status: "starting",
        current: 0,
        total: callIds.length,
        currentFile: "preparing server-side zip...",
        failures: [],
      });

      const payload: ExportRequestPayload = {
        credentials,
        callIds,
        options: {
          includeMedia: true,
          mediaType,
          includeMetadata: extras?.includeMetadata ?? true,
          includeTranscripts: extras?.includeTranscripts ?? false,
        },
      };

      const form = document.createElement("form");
      form.method = "POST";
      form.action = "/api/export";
      form.target = "_self";
      form.enctype = "application/x-www-form-urlencoded";

      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "payload";
      input.value = JSON.stringify(payload);
      form.appendChild(input);
      document.body.appendChild(form);
      form.submit();
      document.body.removeChild(form);

      // Browser handles the download from here. Settle local state shortly after so
      // the modal can show "download started" and be dismissed.
      setTimeout(() => {
        setState({
          status: "complete",
          current: callIds.length,
          total: callIds.length,
          currentFile: "",
          failures: [],
        });
      }, 1500);
    },
    [credentials]
  );

  const startDownloadAll = useCallback(
    (mediaType: MediaType, extras?: BulkDownloadExtraOptions) => {
      if (!credentials) {
        setState({
          status: "complete",
          current: 0,
          total: 0,
          currentFile: "",
          failures: [
            { callId: "", callTitle: "", mediaType: "", error: "Not connected" },
          ],
        });
        return;
      }

      setState({
        status: "starting",
        current: 0,
        total: 0,
        currentFile: "server is walking every call — this may take a few minutes...",
        failures: [],
      });

      const payload: ExportRequestPayload = {
        credentials,
        filter: {},
        options: {
          includeMedia: true,
          mediaType,
          includeMetadata: extras?.includeMetadata ?? true,
          includeTranscripts: extras?.includeTranscripts ?? false,
        },
      };

      const form = document.createElement("form");
      form.method = "POST";
      form.action = "/api/export";
      form.target = "_self";
      form.enctype = "application/x-www-form-urlencoded";

      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "payload";
      input.value = JSON.stringify(payload);
      form.appendChild(input);
      document.body.appendChild(form);
      form.submit();
      document.body.removeChild(form);

      setTimeout(() => {
        setState({
          status: "complete",
          current: 0,
          total: 0,
          currentFile: "",
          failures: [],
        });
      }, 1500);
    },
    [credentials]
  );

  const cancel = useCallback(() => {
    // Browser-native downloads can only be cancelled in the browser itself;
    // we just mirror that locally.
    setState((prev) => ({ ...prev, status: "cancelled" }));
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

  return { state, startDownload, startDownloadAll, cancel, reset };
}
