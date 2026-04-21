"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCallApi } from "@/hooks/use-call-api";
import { useCredentials } from "@/components/credential-provider";
import { formatDuration, formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportDialog } from "@/components/export-dialog";
import {
  AlertCircle,
  ArrowLeft,
  Download,
  Loader2,
  Video,
  Music,
  Users,
  Clock,
  Monitor,
  ArrowUpDown,
  Globe,
  Sparkles,
  MessageSquare,
  Hash,
  Target,
  Package,
} from "lucide-react";
import type { GongCall, NormalizedCall } from "@/lib/types";

interface CallDetailProps {
  callId: string;
}

export function CallDetail({ callId }: CallDetailProps) {
  const router = useRouter();
  const { fetchCallDetail, downloadMedia } = useCallApi();
  const { isConfigured, provider } = useCredentials();

  const [call, setCall] = useState<NormalizedCall | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloadingAudio, setDownloadingAudio] = useState(false);
  const [downloadingVideo, setDownloadingVideo] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    if (!isConfigured) {
      router.push("/");
      return;
    }

    async function load() {
      setLoading(true);
      setError("");
      const result = await fetchCallDetail(callId);
      if (result.error) {
        setError(result.error);
      } else if (result.data) {
        setCall(result.data);
      }
      setLoading(false);
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId, isConfigured]);

  async function handleDownloadAudio() {
    if (!call?.audioUrl) return;
    setDownloadingAudio(true);
    const title = call.title?.replace(/[^a-zA-Z0-9-_ ]/g, "") || "recording";
    const result = await downloadMedia(call.audioUrl, `${title}.mp3`);
    if (result.error) setError(result.error);
    setDownloadingAudio(false);
  }

  async function handleDownloadVideo() {
    if (!call?.videoUrl) return;
    setDownloadingVideo(true);
    const title = call.title?.replace(/[^a-zA-Z0-9-_ ]/g, "") || "recording";
    const result = await downloadMedia(call.videoUrl, `${title}.mp4`);
    if (result.error) setError(result.error);
    setDownloadingVideo(false);
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <Skeleton className="h-6 w-24 rounded-full bg-white/5" />
        <Skeleton className="h-10 w-72 rounded-lg bg-white/5" />
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-20 rounded-full bg-white/5" />
          ))}
        </div>
        <Skeleton className="h-48 w-full rounded-2xl bg-white/5" />
        <Skeleton className="h-64 w-full rounded-2xl bg-white/5" />
      </div>
    );
  }

  if (error && !call) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-8 sm:px-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/")}
          className="rounded-full text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> back
        </Button>
        <Alert variant="destructive" className="rounded-xl border-red-500/20 bg-red-500/10">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!call) return null;

  const internalParties = call.parties.filter((p) => p.affiliation === "Internal");
  const externalParties = call.parties.filter((p) => p.affiliation !== "Internal");

  // Gong-specific deep payload (for AI summary, highlights, etc).
  const gongRaw = provider === "gong" ? (call.raw as GongCall) : null;
  const isVideo = call.media === "Video";
  const exportSupported = provider === "gong" || provider === "salesloft";

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-32 top-1/4 h-64 w-64 rounded-full bg-purple-500/8 blur-[100px]" />
        <div className="absolute -right-32 top-1/2 h-48 w-48 rounded-full bg-pink-500/8 blur-[100px]" />
      </div>

      {/* Back button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/")}
        className="rounded-full text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-1 h-4 w-4" /> back to calls
      </Button>

      {/* Hero section */}
      <div className="relative">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {call.title || "Untitled Call"}
        </h2>
        <p className="mt-1.5 text-base text-muted-foreground">
          {formatDateTime(call.started)}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="gap-1 rounded-full border-white/10 bg-white/5 text-xs text-muted-foreground">
            <Clock className="h-3 w-3 text-purple-400" />
            {formatDuration(call.durationSec)}
          </Badge>
          {call.system && (
            <Badge variant="outline" className="gap-1 rounded-full border-white/10 bg-white/5 text-xs text-muted-foreground">
              <Monitor className="h-3 w-3 text-cyan-400" />
              {call.system}
            </Badge>
          )}
          {call.direction && (
            <Badge variant="outline" className="gap-1 rounded-full border-white/10 bg-white/5 text-xs text-muted-foreground">
              <ArrowUpDown className="h-3 w-3 text-pink-400" />
              {call.direction}
            </Badge>
          )}
          {call.scope && (
            <Badge variant="outline" className="gap-1 rounded-full border-white/10 bg-white/5 text-xs text-muted-foreground">
              <Globe className="h-3 w-3 text-green-400" />
              {call.scope}
            </Badge>
          )}
          {isVideo ? (
            <Badge className="gap-1 rounded-full border-0 bg-purple-500/15 text-xs text-purple-400">
              <Video className="h-3 w-3" /> video
            </Badge>
          ) : (
            <Badge className="gap-1 rounded-full border-0 bg-cyan-500/15 text-xs text-cyan-400">
              <Music className="h-3 w-3" /> audio
            </Badge>
          )}
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="rounded-xl border-red-500/20 bg-red-500/10">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Downloads */}
      <div className="gradient-border rounded-2xl p-[1px]">
        <div className="glass rounded-2xl p-6">
          <h3 className="mb-4 flex items-center gap-2 text-base font-semibold">
            <Download className="h-4 w-4 text-purple-400" /> downloads
          </h3>
          <div className="flex flex-wrap gap-3">
            {exportSupported && (
              <Button
                onClick={() => setExportOpen(true)}
                className="gradient-btn rounded-xl border-0 text-white shadow-lg shadow-purple-500/20"
              >
                <Package className="mr-2 h-4 w-4" />
                download bundle (zip)
              </Button>
            )}
            {call.audioUrl && (
              <Button
                variant="outline"
                onClick={handleDownloadAudio}
                disabled={downloadingAudio}
                className="rounded-xl border-white/10 bg-white/5 hover:border-cyan-500/30 hover:bg-cyan-500/10 hover:text-cyan-400"
              >
                {downloadingAudio ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Music className="mr-2 h-4 w-4" />
                )}
                {downloadingAudio ? "downloading..." : "raw audio"}
              </Button>
            )}
            {call.videoUrl && (
              <Button
                variant="outline"
                onClick={handleDownloadVideo}
                disabled={downloadingVideo}
                className="rounded-xl border-white/10 bg-white/5 hover:border-purple-500/30 hover:bg-purple-500/10 hover:text-purple-400"
              >
                {downloadingVideo ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Video className="mr-2 h-4 w-4" />
                )}
                {downloadingVideo ? "downloading..." : "raw video"}
              </Button>
            )}
          </div>
          {exportSupported && (
            <p className="mt-3 text-xs text-muted-foreground/70">
              Bundle includes media + metadata.json + summary.md. Raw buttons download just the media file.
            </p>
          )}
          {!call.audioUrl && !call.videoUrl && (
            <p className="mt-3 text-sm text-muted-foreground">
              no media available. {provider === "gong"
                ? "might still be processing, or you need the api:calls:read:media-url scope for media."
                : "this conversation may not have a recording yet, or your key lacks the 'Download Conversations' permission."}
            </p>
          )}
        </div>
      </div>

      {exportSupported && (
        <ExportDialog
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          mode="single"
          callIds={[callId]}
          callTitle={call.title || "Untitled Call"}
        />
      )}

      {/* Participants */}
      <div className="gradient-border rounded-2xl p-[1px]">
        <div className="glass rounded-2xl p-6">
          <h3 className="mb-4 flex items-center gap-2 text-base font-semibold">
            <Users className="h-4 w-4 text-pink-400" /> participants ({call.parties.length})
          </h3>
          <div className="space-y-5">
            {internalParties.length > 0 && (
              <div>
                <p className="mb-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
                  internal
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {internalParties.map((p, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition-colors hover:bg-white/[0.04]">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 text-sm font-semibold text-purple-400">
                        {(p.name ?? p.email ?? "?")[0].toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{p.name ?? "Unknown"}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[p.title, p.email].filter(Boolean).join(" - ")}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {externalParties.length > 0 && (
              <div>
                <p className="mb-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
                  external
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {externalParties.map((p, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition-colors hover:bg-white/[0.04]">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 text-sm font-semibold text-cyan-400">
                        {(p.name ?? p.email ?? "?")[0].toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{p.name ?? "Unknown"}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[p.title, p.email].filter(Boolean).join(" - ")}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {call.parties.length === 0 && (
              <p className="text-sm text-muted-foreground">no participant data available</p>
            )}
          </div>
        </div>
      </div>

      {/* AI Summary */}
      {call.summary && (
        <div className="gradient-border rounded-2xl p-[1px]">
          <div className="glass rounded-2xl p-6">
            <h3 className="mb-3 flex items-center gap-2 text-base font-semibold">
              <Sparkles className="h-4 w-4 text-yellow-400" /> ai summary
            </h3>
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-muted-foreground">
              {call.summary}
            </p>
          </div>
        </div>
      )}

      {/* Highlights (Gong only) */}
      {gongRaw?.content?.highlights && gongRaw.content.highlights.length > 0 && (
        <div className="gradient-border rounded-2xl p-[1px]">
          <div className="glass rounded-2xl p-6">
            <h3 className="mb-4 flex items-center gap-2 text-base font-semibold">
              <MessageSquare className="h-4 w-4 text-green-400" /> highlights
            </h3>
            <div className="space-y-4">
              {gongRaw.content.highlights.map((h, i) => (
                <div key={i}>
                  <h4 className="font-medium text-foreground">{h.title}</h4>
                  <ul className="ml-4 mt-1.5 list-disc space-y-1 marker:text-purple-400/50">
                    {h.items.map((item, j) => (
                      <li key={j} className="text-[15px] text-muted-foreground">
                        {item.text}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Topics (Gong only) */}
      {gongRaw?.content?.topics && gongRaw.content.topics.length > 0 && (
        <div className="gradient-border rounded-2xl p-[1px]">
          <div className="glass rounded-2xl p-6">
            <h3 className="mb-3 flex items-center gap-2 text-base font-semibold">
              <Hash className="h-4 w-4 text-cyan-400" /> topics discussed
            </h3>
            <div className="flex flex-wrap gap-2">
              {gongRaw.content.topics.map((t, i) => (
                <Badge
                  key={i}
                  variant="outline"
                  className="rounded-full border-white/10 bg-white/5 text-xs text-muted-foreground"
                >
                  {t.name}
                  {t.duration ? ` (${formatDuration(t.duration)})` : ""}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Call Outcome */}
      {call.outcome && (
        <div className="gradient-border rounded-2xl p-[1px]">
          <div className="glass rounded-2xl p-6">
            <h3 className="mb-3 flex items-center gap-2 text-base font-semibold">
              <Target className="h-4 w-4 text-orange-400" /> call outcome
            </h3>
            <Badge className="rounded-full border-0 bg-purple-500/15 px-3 py-1 text-sm text-purple-400">
              {call.outcome}
            </Badge>
          </div>
        </div>
      )}

      {/* Bottom spacer */}
      <div className="h-8" />
    </div>
  );
}
