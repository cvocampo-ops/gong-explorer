"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useExport } from "@/hooks/use-export";
import { AlertCircle, Download, Loader2, X } from "lucide-react";
import type { ExportFilter } from "@/lib/types";

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  mode: "single" | "selected" | "filter";
  callIds?: string[];
  filter?: ExportFilter;
  count?: number; // expected number of calls (for display)
  callTitle?: string; // for single mode
}

export function ExportDialog({
  open,
  onClose,
  mode,
  callIds,
  filter,
  count,
  callTitle,
}: ExportDialogProps) {
  const { submitExport } = useExport();
  const [includeMedia, setIncludeMedia] = useState(true);
  const [includeTranscripts, setIncludeTranscripts] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const title =
    mode === "single"
      ? "Download call bundle"
      : mode === "selected"
        ? `Export ${count ?? callIds?.length ?? 0} selected calls`
        : "Export all matching filter";

  const subtitle =
    mode === "single"
      ? callTitle ?? "Single call"
      : mode === "selected"
        ? "Zip with one folder per call plus manifest"
        : `Range: ${filter?.fromDate ?? "?"} - ${filter?.toDate ?? "?"}`;

  const largeWarning = mode !== "single" && (count ?? 0) > 500;

  function handleSubmit() {
    setSubmitting(true);
    setError("");
    const result = submitExport({
      callIds: mode === "filter" ? undefined : callIds,
      filter: mode === "filter" ? filter : undefined,
      options: { includeMedia, includeTranscripts },
    });
    if (result.error) {
      setError(result.error);
      setSubmitting(false);
      return;
    }
    // Give the browser a tick to start the download, then close
    setTimeout(() => {
      setSubmitting(false);
      onClose();
    }, 800);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#0a0a0a] p-6 shadow-2xl shadow-purple-500/10"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 text-muted-foreground hover:bg-white/5 hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <Download className="h-4 w-4 text-purple-400" /> {title}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>

        <div className="mt-5 space-y-3">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 hover:bg-white/[0.04]">
            <input
              type="checkbox"
              checked={includeMedia}
              onChange={(e) => setIncludeMedia(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-purple-500"
            />
            <div>
              <div className="text-sm font-medium">Include media files</div>
              <div className="text-xs text-muted-foreground">
                Audio (.mp3) or video (.mp4). Large exports can be multi-GB. Uncheck for a fast metadata-only pull.
              </div>
            </div>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 hover:bg-white/[0.04]">
            <input
              type="checkbox"
              checked={includeTranscripts}
              onChange={(e) => setIncludeTranscripts(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-purple-500"
            />
            <div>
              <div className="text-sm font-medium">Include transcripts</div>
              <div className="text-xs text-muted-foreground">
                Adds a <code className="rounded bg-white/5 px-1">transcript.txt</code> per call. One extra API call per call, slower.
              </div>
            </div>
          </label>
        </div>

        {largeWarning && (
          <Alert className="mt-4 rounded-xl border-yellow-500/20 bg-yellow-500/10">
            <AlertCircle className="h-4 w-4 text-yellow-400" />
            <AlertDescription className="text-xs text-yellow-200">
              This is a large export ({count} calls). It may take a while and could be rate-limited. Consider splitting into smaller date ranges.
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive" className="mt-4 rounded-xl border-red-500/20 bg-red-500/10">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
            className="rounded-xl"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="gradient-btn rounded-xl border-0 px-5 text-white shadow-lg shadow-purple-500/20"
          >
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {submitting ? "starting..." : "download zip"}
          </Button>
        </div>

        <p className="mt-4 text-[11px] text-muted-foreground/70">
          The ZIP streams to your browser. Keep this tab open until the download completes.
        </p>
      </div>
    </div>
  );
}
