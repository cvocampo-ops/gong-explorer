"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { X, DownloadCloud, Music, Video, Layers, FileText, MessageSquareText } from "lucide-react";
import type { MediaType } from "@/hooks/use-bulk-download";

export interface DownloadAllOptions {
  mediaType: MediaType;
  includeMetadata: boolean;
  includeTranscripts: boolean;
}

// ~1 MB per minute for MP3, ~6 MB per minute for MP4 (webcam/screen share quality)
const MB_PER_MIN_AUDIO = 1;
const MB_PER_MIN_VIDEO = 6;

function estimateSize(
  totalCalls: number,
  avgDurationSeconds: number,
  mediaType: MediaType
): string {
  const avgMinutes = avgDurationSeconds / 60;
  let mbPerCall = 0;
  if (mediaType === "audio" || mediaType === "both") mbPerCall += MB_PER_MIN_AUDIO * avgMinutes;
  if (mediaType === "video" || mediaType === "both") mbPerCall += MB_PER_MIN_VIDEO * avgMinutes;
  const totalMb = mbPerCall * totalCalls;
  if (totalMb < 1024) return `~${Math.round(totalMb)} MB`;
  return `~${(totalMb / 1024).toFixed(1)} GB`;
}

interface DownloadAllDialogProps {
  totalCalls: number;
  avgDurationSeconds: number;
  onConfirm: (options: DownloadAllOptions) => void;
  onClose: () => void;
}

const mediaOptions: Array<{
  value: MediaType;
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    value: "audio",
    label: "Audio (MP3)",
    description: "Call audio recordings only",
    icon: <Music className="h-4 w-4" />,
  },
  {
    value: "video",
    label: "Video (MP4)",
    description: "Call video recordings only",
    icon: <Video className="h-4 w-4" />,
  },
  {
    value: "both",
    label: "Both",
    description: "Audio and video for every call",
    icon: <Layers className="h-4 w-4" />,
  },
];

export function DownloadAllDialog({ totalCalls, avgDurationSeconds, onConfirm, onClose }: DownloadAllDialogProps) {
  const [selected, setSelected] = useState<MediaType>("both");
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [includeTranscripts, setIncludeTranscripts] = useState(false);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-strong mx-4 w-full max-w-sm rounded-2xl border border-white/10 p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-lg font-semibold">download all calls</h3>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="mb-5 text-sm text-muted-foreground">
          every call in your account will be fetched and packaged into a zip
        </p>

        {/* Media type options */}
        <div className="mb-5 space-y-2">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            what to include
          </label>
          <div className="space-y-1.5">
            {mediaOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSelected(opt.value)}
                className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all ${
                  selected === opt.value
                    ? "border-purple-500/30 bg-purple-500/[0.08]"
                    : "border-white/[0.06] bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]"
                }`}
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                    selected === opt.value
                      ? "bg-purple-500/20 text-purple-400"
                      : "bg-white/5 text-muted-foreground"
                  }`}
                >
                  {opt.icon}
                </div>
                <div>
                  <div className={`text-sm font-medium ${selected === opt.value ? "text-purple-400" : "text-foreground"}`}>
                    {opt.label}
                  </div>
                  <div className="text-xs text-muted-foreground">{opt.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Extras (metadata / transcripts) */}
        <div className="mb-5 space-y-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 hover:bg-white/[0.04]">
            <input
              type="checkbox"
              checked={includeMetadata}
              onChange={(e) => setIncludeMetadata(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-purple-500"
            />
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-purple-400" />
              <div>
                <div className="text-sm font-medium">include metadata</div>
                <div className="text-xs text-muted-foreground">
                  metadata.json, summary.md, and manifest.csv per call
                </div>
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
            <div className="flex items-center gap-2">
              <MessageSquareText className="h-4 w-4 text-purple-400" />
              <div>
                <div className="text-sm font-medium">include transcripts</div>
                <div className="text-xs text-muted-foreground">
                  adds transcript.txt per call. extra API call per call, slower.
                </div>
              </div>
            </div>
          </label>
        </div>

        {/* Size estimate */}
        {totalCalls > 0 && avgDurationSeconds > 0 && (
          <div className="mb-5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">estimated size</span>
              <span className="text-sm font-medium text-purple-400">
                {estimateSize(totalCalls, avgDurationSeconds, selected)}
              </span>
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">total calls</span>
              <span className="text-xs text-muted-foreground">{totalCalls.toLocaleString()}</span>
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground/60">
              estimate based on avg call duration. actual size may vary.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1 rounded-xl border-white/10 bg-white/5"
          >
            cancel
          </Button>
          <Button
            onClick={() => onConfirm({ mediaType: selected, includeMetadata, includeTranscripts })}
            className="gradient-btn flex-1 rounded-xl border-0 text-white shadow-lg shadow-purple-500/10"
          >
            <DownloadCloud className="mr-1.5 h-4 w-4" />
            start download
          </Button>
        </div>
      </div>
    </div>
  );
}
