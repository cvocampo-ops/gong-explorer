"use client";

import { Button } from "@/components/ui/button";
import { X, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import type { BulkDownloadState } from "@/hooks/use-bulk-download";

interface BulkDownloadModalProps {
  state: BulkDownloadState;
  onCancel: () => void;
  onClose: () => void;
}

export function BulkDownloadModal({ state, onCancel, onClose }: BulkDownloadModalProps) {
  if (state.status === "idle") return null;

  const progressPercent = state.total > 0 ? Math.round((state.current / state.total) * 100) : 0;
  const isActive = state.status === "downloading";
  const isDone = state.status === "complete" || state.status === "cancelled";
  const successCount = state.current - state.failures.length;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-strong mx-4 w-full max-w-md rounded-2xl border border-white/10 p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {isActive && "downloading..."}
            {state.status === "complete" && "download complete"}
            {state.status === "cancelled" && "download cancelled"}
          </h3>
          {isDone && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Progress bar */}
        <div className="mb-4">
          <div className="mb-2 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {state.current} / {state.total} files
            </span>
            <span>{progressPercent}%</span>
          </div>
        </div>

        {/* Current file */}
        {isActive && state.currentFile && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-purple-400" />
            <span className="truncate text-sm text-muted-foreground">{state.currentFile}</span>
          </div>
        )}

        {/* Completion summary */}
        {isDone && (
          <div className="mb-4 space-y-2">
            {successCount > 0 && (
              <div className="flex items-center gap-2 text-sm text-green-400">
                <CheckCircle className="h-4 w-4 shrink-0" />
                <span>
                  {successCount} file{successCount !== 1 ? "s" : ""} downloaded successfully
                </span>
              </div>
            )}
            {state.failures.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-red-400">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>
                    {state.failures.length} file{state.failures.length !== 1 ? "s" : ""} failed
                  </span>
                </div>
                <div className="max-h-32 overflow-y-auto rounded-lg border border-white/5 bg-white/[0.02] p-2">
                  {state.failures.map((f, i) => (
                    <div key={i} className="text-xs text-muted-foreground">
                      <span className="text-foreground">{f.callTitle}</span>
                      <span className="text-white/20"> | </span>
                      <span>{f.mediaType}</span>
                      <span className="text-white/20"> | </span>
                      <span className="text-red-400/70">{f.error}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {state.status === "cancelled" && (
              <p className="text-xs text-muted-foreground">
                download was cancelled. {successCount > 0 ? "partial zip was saved." : "no files were saved."}
              </p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          {isActive && (
            <Button
              variant="outline"
              onClick={onCancel}
              className="rounded-xl border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20"
            >
              cancel
            </Button>
          )}
          {isDone && (
            <Button
              onClick={onClose}
              className="gradient-btn rounded-xl border-0 px-5 text-white"
            >
              done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
