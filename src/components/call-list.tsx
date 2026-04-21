"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useCallApi } from "@/hooks/use-call-api";
import { useCredentials } from "@/components/credential-provider";
import { formatDuration, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle,
  ChevronRight,
  Loader2,
  Phone,
  Video,
  Users,
  Search,
  Flame,
  Zap,
  MousePointerClick,
  Check,
  DownloadCloud,
  Upload,
} from "lucide-react";
import type { NormalizedCall } from "@/lib/types";
import { BulkDownloadBar } from "@/components/bulk-download-bar";
import { BulkDownloadModal } from "@/components/bulk-download-modal";
import { DownloadAllDialog } from "@/components/download-all-dialog";
import { GongImport } from "@/components/gong-import";
import { useBulkDownload } from "@/hooks/use-bulk-download";
import type { MediaType } from "@/hooks/use-bulk-download";

function defaultFromDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().split("T")[0];
}

function defaultToDate(): string {
  return new Date().toISOString().split("T")[0];
}

export function CallList() {
  const router = useRouter();
  const { fetchCalls, fetchAllCalls } = useCallApi();
  const { isConfigured, provider } = useCredentials();

  const [showImport, setShowImport] = useState(false);
  const [calls, setCalls] = useState<NormalizedCall[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [toDate, setToDate] = useState(defaultToDate);
  const [totalRecords, setTotalRecords] = useState<number | null>(null);
  const [rateLimitRemaining, setRateLimitRemaining] = useState<number | undefined>();

  // Selection state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedCalls, setSelectedCalls] = useState<Map<string, NormalizedCall>>(new Map());
  const [mediaType, setMediaType] = useState<MediaType>("both");
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [includeTranscripts, setIncludeTranscripts] = useState(false);
  const [isLoadingAll, setIsLoadingAll] = useState(false);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [showDownloadAllDialog, setShowDownloadAllDialog] = useState(false);

  // Bulk download
  const { state: downloadState, startDownload, cancel: cancelDownload, reset: resetDownload } = useBulkDownload();

  const loadCalls = useCallback(
    async (opts?: { append?: boolean; cursorOverride?: string }) => {
      const isAppend = opts?.append ?? false;
      if (isAppend) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setCalls([]);
        setCursor(undefined);
      }
      setError("");

      const result = await fetchCalls({
        cursor: isAppend ? (opts?.cursorOverride ?? cursor) : undefined,
        fromDate: `${fromDate}T00:00:00Z`,
        toDate: `${toDate}T23:59:59Z`,
      });

      if (result.rateLimitRemaining !== undefined) {
        setRateLimitRemaining(result.rateLimitRemaining);
      }

      if (result.error) {
        setError(result.error);
      } else if (result.data) {
        if (isAppend) {
          setCalls((prev) => [...prev, ...result.data!.calls]);
        } else {
          setCalls(result.data.calls);
          setTotalRecords(result.data.totalRecords ?? null);
        }
        setCursor(result.data.cursor);
      }

      setLoading(false);
      setLoadingMore(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fromDate, toDate, cursor]
  );

  useEffect(() => {
    if (isConfigured) {
      loadCalls();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigured]);

  function handleSearch() {
    loadCalls();
  }

  function handleLoadMore() {
    loadCalls({ append: true });
  }

  function toggleSelection(call: NormalizedCall) {
    const id = call.id;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setSelectedCalls((prev) => {
      const next = new Map(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.set(id, call);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setSelectedCalls(new Map());
  }

  function toggleSelectionMode() {
    if (selectionMode) {
      clearSelection();
    }
    setSelectionMode((prev) => !prev);
  }

  async function handleSelectAll() {
    setIsLoadingAll(true);
    const result = await fetchAllCalls(
      `${fromDate}T00:00:00Z`,
      `${toDate}T23:59:59Z`,
      {}
    );
    setIsLoadingAll(false);

    if (result.data) {
      const ids = new Set<string>();
      const callMap = new Map<string, NormalizedCall>();
      for (const call of result.data) {
        ids.add(call.id);
        callMap.set(call.id, call);
      }
      setSelectedIds(ids);
      setSelectedCalls(callMap);
    }
  }

  function handleDownload() {
    const callsToDownload = Array.from(selectedCalls.values());
    startDownload(callsToDownload, mediaType, { includeMetadata, includeTranscripts });
  }

  function handleCloseModal() {
    resetDownload();
  }

  function handleDownloadAll() {
    setShowDownloadAllDialog(true);
  }

  async function handleDownloadAllConfirm(options: {
    mediaType: MediaType;
    includeMetadata: boolean;
    includeTranscripts: boolean;
  }) {
    setShowDownloadAllDialog(false);
    setIsDownloadingAll(true);
    // API requires date range — use a wide range to get everything
    const allTimeFrom = "2015-01-01T00:00:00Z";
    const allTimeTo = new Date().toISOString();
    const result = await fetchAllCalls(allTimeFrom, allTimeTo, {});
    setIsDownloadingAll(false);

    if (result.data && result.data.length > 0) {
      startDownload(result.data, options.mediaType, {
        includeMetadata: options.includeMetadata,
        includeTranscripts: options.includeTranscripts,
      });
    }
  }

  if (showImport && provider === "gong") {
    return <GongImport onBack={() => setShowImport(false)} />;
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -right-48 top-0 h-96 w-96 rounded-full bg-purple-500/5 blur-[120px]" />
        <div className="absolute -left-48 bottom-0 h-96 w-96 rounded-full bg-pink-500/5 blur-[120px]" />
      </div>

      {/* Page header */}
      <div className="relative">
        <h2 className="text-3xl font-bold tracking-tight">
          your {provider === "salesloft" ? "salesloft" : "gong"} calls <Flame className="mb-1 inline h-6 w-6 text-orange-400" />
        </h2>
        <p className="text-base text-muted-foreground">
          browse, vibe check, and download recordings
        </p>
      </div>

      {/* Filter bar */}
      <div className="gradient-border relative rounded-xl p-[1px]">
        <div className="glass flex flex-wrap items-end gap-3 rounded-xl p-4">
          <div className="space-y-1.5">
            <Label htmlFor="from" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              From
            </Label>
            <Input
              id="from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-40 rounded-lg border-white/10 bg-white/5"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              To
            </Label>
            <Input
              id="to"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-40 rounded-lg border-white/10 bg-white/5"
            />
          </div>
          <Button
            onClick={handleSearch}
            disabled={loading}
            className="gradient-btn rounded-xl border-0 px-5 text-white shadow-lg shadow-purple-500/10"
          >
            {loading ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-1.5 h-4 w-4" />
            )}
            {loading ? "loading..." : "fetch"}
          </Button>
          {calls.length > 0 && (
            <Button
              variant="outline"
              onClick={toggleSelectionMode}
              className={`rounded-xl border-white/10 px-4 transition-all ${
                selectionMode
                  ? "border-purple-500/30 bg-purple-500/10 text-purple-400"
                  : "bg-white/5 hover:border-purple-500/30 hover:bg-purple-500/10 hover:text-purple-400"
              }`}
            >
              <MousePointerClick className="mr-1.5 h-4 w-4" />
              {selectionMode ? "cancel" : "select"}
            </Button>
          )}
          {calls.length > 0 && !selectionMode && (
            <Button
              variant="outline"
              onClick={handleDownloadAll}
              disabled={isDownloadingAll}
              className="rounded-xl border-white/10 bg-white/5 px-4 hover:border-purple-500/30 hover:bg-purple-500/10 hover:text-purple-400"
            >
              {isDownloadingAll ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <DownloadCloud className="mr-1.5 h-4 w-4" />
              )}
              {isDownloadingAll ? "loading..." : "download all"}
            </Button>
          )}
          {provider === "gong" && (
            <Button
              variant="outline"
              onClick={() => setShowImport(true)}
              className="rounded-xl border-white/10 bg-white/5 px-4 hover:border-purple-500/30 hover:bg-purple-500/10 hover:text-purple-400"
            >
              <Upload className="mr-1.5 h-4 w-4" />
              import
            </Button>
          )}
          <div className="ml-auto flex items-center gap-3 text-xs">
            {totalRecords !== null && (
              <span className="text-muted-foreground">
                {totalRecords.toLocaleString()} calls
              </span>
            )}
            {rateLimitRemaining !== undefined && (
              <Badge
                variant="outline"
                className={`rounded-full text-xs ${
                  rateLimitRemaining < 1000
                    ? "border-red-500/30 bg-red-500/10 text-red-400"
                    : "border-purple-500/30 bg-purple-500/10 text-purple-400"
                }`}
              >
                <Zap className="mr-1 h-3 w-3" />
                {rateLimitRemaining.toLocaleString()} left
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <Alert variant="destructive" className="rounded-xl border-red-500/20 bg-red-500/10">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-white/[0.06] p-4">
              <div className="flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded-xl bg-white/5" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48 rounded-lg bg-white/5" />
                  <Skeleton className="h-3 w-32 rounded-lg bg-white/5" />
                </div>
                <Skeleton className="h-6 w-16 rounded-full bg-white/5" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Call cards */}
      {!loading && calls.length > 0 && (
        <>
          <div className="space-y-2">
            {calls.map((call) => {
              const isSelected = selectedIds.has(call.id);
              return (
              <div
                key={call.id}
                onClick={() => {
                  if (selectionMode) {
                    toggleSelection(call);
                  } else {
                    router.push(`/calls/${call.id}`);
                  }
                }}
                className={`group relative cursor-pointer rounded-xl border p-4 transition-all duration-200 ${
                  isSelected
                    ? "border-purple-500/30 bg-purple-500/[0.06]"
                    : "border-white/[0.06] bg-white/[0.02] hover:border-purple-500/20 hover:bg-white/[0.04] hover:shadow-lg hover:shadow-purple-500/5"
                }`}
              >
                <div className="flex items-center gap-4">
                  {/* Checkbox */}
                  {selectionMode && (
                    <div
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all ${
                        isSelected
                          ? "border-purple-500 bg-purple-500 text-white"
                          : "border-white/20 bg-white/5"
                      }`}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </div>
                  )}

                  {/* Icon */}
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                    call.media === "Video"
                      ? "bg-gradient-to-br from-purple-500/20 to-pink-500/20 text-purple-400"
                      : "bg-gradient-to-br from-cyan-500/20 to-blue-500/20 text-cyan-400"
                  }`}>
                    {call.media === "Video" ? (
                      <Video className="h-4 w-4" />
                    ) : (
                      <Phone className="h-4 w-4" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-foreground">
                        {call.title || "Untitled Call"}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-3 text-sm text-muted-foreground">
                      <span>{formatDate(call.started)}</span>
                      <span className="text-white/10">|</span>
                      <span>{formatDuration(call.durationSec)}</span>
                      <span className="text-white/10">|</span>
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {call.parties.length}
                      </span>
                    </div>
                  </div>

                  {/* Tags */}
                  <div className="hidden items-center gap-2 sm:flex">
                    {call.system && (
                      <Badge variant="outline" className="rounded-full border-white/10 bg-white/5 text-[10px] font-medium text-muted-foreground">
                        {call.system}
                      </Badge>
                    )}
                    {call.direction && (
                      <Badge variant="outline" className="rounded-full border-white/10 bg-white/5 text-[10px] font-medium text-muted-foreground">
                        {call.direction}
                      </Badge>
                    )}
                  </div>

                  {/* Arrow */}
                  {!selectionMode && (
                    <ChevronRight className="h-4 w-4 text-muted-foreground/30 transition-all group-hover:translate-x-0.5 group-hover:text-purple-400" />
                  )}
                </div>
              </div>
              );
            })}
          </div>

          {/* Load more */}
          {cursor && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="rounded-full border-white/10 bg-white/5 px-6 hover:border-purple-500/30 hover:bg-purple-500/10 hover:text-purple-400"
              >
                {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {loadingMore ? "loading..." : `show more (${calls.length} loaded)`}
              </Button>
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!loading && !error && calls.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5">
            <Phone className="h-7 w-7 text-muted-foreground/30" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">
            no calls found
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            try adjusting the date range above
          </p>
        </div>
      )}

      {/* Spacer for floating bar */}
      {selectionMode && <div className="h-24" />}

      {/* Bulk download bar */}
      {selectionMode && (
        <BulkDownloadBar
          selectedCount={selectedIds.size}
          totalRecords={totalRecords}
          mediaType={mediaType}
          onMediaTypeChange={setMediaType}
          includeMetadata={includeMetadata}
          onIncludeMetadataChange={setIncludeMetadata}
          includeTranscripts={includeTranscripts}
          onIncludeTranscriptsChange={setIncludeTranscripts}
          onSelectAll={handleSelectAll}
          onClear={clearSelection}
          onDownload={handleDownload}
          isLoadingAll={isLoadingAll}
        />
      )}

      {/* Download All options dialog */}
      {showDownloadAllDialog && (
        <DownloadAllDialog
          totalCalls={totalRecords ?? calls.length}
          avgDurationSeconds={
            calls.length > 0
              ? calls.reduce((sum, c) => sum + c.durationSec, 0) / calls.length
              : 0
          }
          onConfirm={handleDownloadAllConfirm}
          onClose={() => setShowDownloadAllDialog(false)}
        />
      )}

      {/* Download progress modal */}
      <BulkDownloadModal
        state={downloadState}
        onCancel={cancelDownload}
        onClose={handleCloseModal}
      />
    </div>
  );
}
