"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Download,
  X,
  CheckSquare,
  Loader2,
  Music,
  Video,
  Layers,
  FileText,
  MessageSquareText,
} from "lucide-react";
import type { MediaType } from "@/hooks/use-bulk-download";

interface BulkDownloadBarProps {
  selectedCount: number;
  totalRecords: number | null;
  mediaType: MediaType;
  onMediaTypeChange: (type: MediaType) => void;
  includeMetadata: boolean;
  onIncludeMetadataChange: (v: boolean) => void;
  includeTranscripts: boolean;
  onIncludeTranscriptsChange: (v: boolean) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onDownload: () => void;
  isLoadingAll: boolean;
}

const mediaOptions: Array<{ value: MediaType; label: string; icon: React.ReactNode }> = [
  { value: "audio", label: "Audio", icon: <Music className="h-3 w-3" /> },
  { value: "video", label: "Video", icon: <Video className="h-3 w-3" /> },
  { value: "both", label: "Both", icon: <Layers className="h-3 w-3" /> },
];

export function BulkDownloadBar({
  selectedCount,
  totalRecords,
  mediaType,
  onMediaTypeChange,
  includeMetadata,
  onIncludeMetadataChange,
  includeTranscripts,
  onIncludeTranscriptsChange,
  onSelectAll,
  onClear,
  onDownload,
  isLoadingAll,
}: BulkDownloadBarProps) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-4">
      <div className="mx-auto max-w-5xl">
        <div className="glass-strong rounded-2xl border border-white/10 p-4 shadow-2xl shadow-purple-500/10">
          <div className="flex flex-wrap items-center gap-3">
            {/* Selection count */}
            <Badge
              variant="outline"
              className="rounded-full border-purple-500/30 bg-purple-500/10 px-3 py-1 text-sm text-purple-400"
            >
              {selectedCount} call{selectedCount !== 1 ? "s" : ""} selected
            </Badge>

            {/* Select All */}
            {totalRecords !== null && selectedCount < totalRecords && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onSelectAll}
                disabled={isLoadingAll}
                className="rounded-full text-xs text-muted-foreground hover:text-purple-400"
              >
                {isLoadingAll ? (
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                ) : (
                  <CheckSquare className="mr-1.5 h-3 w-3" />
                )}
                {isLoadingAll
                  ? "loading all calls..."
                  : `select all (${totalRecords.toLocaleString()})`}
              </Button>
            )}

            {/* Spacer */}
            <div className="flex-1" />

            {/* Media type picker */}
            <div className="flex items-center rounded-full border border-white/10 bg-white/5 p-0.5">
              {mediaOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onMediaTypeChange(opt.value)}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all ${
                    mediaType === opt.value
                      ? "bg-purple-500/20 text-purple-400"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Metadata toggle */}
            <button
              onClick={() => onIncludeMetadataChange(!includeMetadata)}
              title="include metadata.json, summary.md, and manifest.csv"
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                includeMetadata
                  ? "border-purple-500/30 bg-purple-500/10 text-purple-400"
                  : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"
              }`}
            >
              <FileText className="h-3 w-3" /> metadata
            </button>

            {/* Transcripts toggle */}
            <button
              onClick={() => onIncludeTranscriptsChange(!includeTranscripts)}
              title="include transcript.txt (slower; extra API call per call)"
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                includeTranscripts
                  ? "border-purple-500/30 bg-purple-500/10 text-purple-400"
                  : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"
              }`}
            >
              <MessageSquareText className="h-3 w-3" /> transcripts
            </button>

            {/* Download button */}
            <Button
              onClick={onDownload}
              disabled={selectedCount === 0}
              className="gradient-btn rounded-xl border-0 px-5 text-white shadow-lg shadow-purple-500/10 disabled:opacity-40"
            >
              <Download className="mr-1.5 h-4 w-4" />
              download zip
            </Button>

            {/* Clear */}
            <Button
              variant="ghost"
              size="icon"
              onClick={onClear}
              className="h-8 w-8 rounded-full text-muted-foreground hover:text-red-400"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
