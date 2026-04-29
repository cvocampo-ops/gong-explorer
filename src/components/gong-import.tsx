"use client";

import { useState, useRef, type DragEvent } from "react";
import { useGongImport } from "@/hooks/use-gong-import";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ImportCallMetadata } from "@/lib/types";
import {
  Upload,
  Link,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Info,
  ExternalLink,
  FileVideo,
  X,
  Sparkles,
  Clock,
  HardDrive,
  Zap,
  FolderOpen,
  ArrowLeft,
  Archive,
  XCircle,
  MinusCircle,
} from "lucide-react";

const ACCEPTED_EXTENSIONS = ".wav,.mp3,.mp4,.mkv,.flac";
const ACCEPTED_TYPES = [
  "video/mp4",
  "video/x-matroska",
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/flac",
];

function generateClientId(): string {
  return `ce-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface GongImportProps {
  onBack: () => void;
}

export function GongImport({ onBack }: GongImportProps) {
  const {
    workspaces,
    workspacesLoading,
    importState,
    importManual,
    importAutomatic,
    importZip,
    resetImport,
  } = useGongImport();

  // Mode toggle
  const [mode, setMode] = useState<"manual" | "automatic" | "zip">("manual");

  // File state (manual + zip)
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // URL state (automatic)
  const [sourceUrl, setSourceUrl] = useState("");

  // Metadata fields
  const [title, setTitle] = useState("");
  const [actualStart, setActualStart] = useState(
    new Date().toISOString().slice(0, 16)
  );
  const [direction, setDirection] = useState<"Inbound" | "Outbound" | "Conference" | "Unknown">("Inbound");
  const [primaryUser, setPrimaryUser] = useState("");
  const [partyName, setPartyName] = useState("");
  const [partyEmail, setPartyEmail] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [zipPrimaryUserOverride, setZipPrimaryUserOverride] = useState("");

  function handleDrag(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped && isAcceptedFile(dropped)) {
      setFile(dropped);
    }
  }

  function isAcceptedFile(f: File): boolean {
    if (mode === "zip") {
      return f.name.toLowerCase().endsWith(".zip") || f.type === "application/zip";
    }
    if (ACCEPTED_TYPES.includes(f.type)) return true;
    const ext = f.name.split(".").pop()?.toLowerCase();
    return ["wav", "mp3", "mp4", "mkv", "flac"].includes(ext ?? "");
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
  }

  function clearFile() {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function buildMetadata(): ImportCallMetadata {
    const parties = [];
    if (partyName || partyEmail) {
      parties.push({
        ...(partyName && { name: partyName }),
        ...(partyEmail && { emailAddress: partyEmail }),
      });
    }

    return {
      title: title || undefined,
      actualStart: new Date(actualStart).toISOString(),
      direction,
      primaryUser,
      parties,
      clientUniqueId: generateClientId(),
      ...(workspaceId && { workspaceId }),
    };
  }

  async function handleSubmit() {
    if (mode === "zip") {
      if (!file) return;
      const overrides: { workspaceId?: string; primaryUser?: string } = {};
      if (workspaceId) overrides.workspaceId = workspaceId;
      const pu = zipPrimaryUserOverride.trim();
      if (pu) overrides.primaryUser = pu;
      await importZip(file, Object.keys(overrides).length ? overrides : undefined);
      return;
    }

    if (!primaryUser.trim()) return;

    const metadata = buildMetadata();

    if (mode === "manual" && file) {
      await importManual(file, metadata);
    } else if (mode === "automatic" && sourceUrl.trim()) {
      await importAutomatic(sourceUrl.trim(), metadata);
    }
  }

  const canSubmit =
    ((mode === "zip" && file) ||
      (mode === "manual" && file && primaryUser.trim()) ||
      (mode === "automatic" && sourceUrl.trim() && primaryUser.trim())) &&
    importState.status !== "uploading";

  // Bulk success view (full-export ZIP)
  if (importState.status === "success" && importState.bulk) {
    const { summary, rows } = importState.bulk;
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6">
        <div className="gradient-border rounded-xl p-[1px]">
          <div className="glass rounded-xl p-6">
            <div className="mb-5 flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-green-500/10">
                <Archive className="h-6 w-6 text-green-400" />
              </div>
              <div>
                <h3 className="text-xl font-bold">bulk import complete</h3>
                <p className="text-sm text-muted-foreground">
                  {summary.succeeded} of {summary.total} calls imported
                  {summary.failed > 0 && ` · ${summary.failed} failed`}
                  {summary.skipped > 0 && ` · ${summary.skipped} skipped`}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              {rows.map((row) => (
                <div
                  key={row.folder}
                  className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2"
                >
                  {row.status === "ok" && (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-green-400" />
                  )}
                  {row.status === "error" && (
                    <XCircle className="h-4 w-4 shrink-0 text-red-400" />
                  )}
                  {row.status === "skipped" && (
                    <MinusCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {row.title ?? row.folder}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.folder}
                      {row.error && ` — ${row.error}`}
                    </p>
                  </div>
                  {row.gongUrl && (
                    <a
                      href={row.gongUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 rounded-md border border-purple-500/30 bg-purple-500/10 px-2 py-1 text-xs text-purple-400 hover:bg-purple-500/20"
                    >
                      open
                    </a>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-6 flex justify-center gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  resetImport();
                  setFile(null);
                }}
                className="rounded-xl border-white/10 bg-white/5"
              >
                import another
              </Button>
              <Button
                onClick={onBack}
                className="gradient-btn rounded-xl border-0 text-white"
              >
                back to calls
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Single-call success view
  if (importState.status === "success" && importState.result) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6">
        <div className="gradient-border rounded-xl p-[1px]">
          <div className="glass rounded-xl p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-green-500/10">
              <CheckCircle2 className="h-8 w-8 text-green-400" />
            </div>
            <h3 className="text-xl font-bold">import successful</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              your recording has been queued for processing in Gong
            </p>

            <div className="mx-auto mt-6 max-w-sm space-y-3">
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Call ID
                </span>
                <p className="mt-1 font-mono text-sm text-foreground">
                  {importState.result.callId}
                </p>
              </div>

              {importState.result.gongUrl && (
                <a
                  href={importState.result.gongUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center justify-center gap-2 rounded-xl border border-purple-500/30 bg-purple-500/10 px-4 py-3 text-sm font-medium text-purple-400 transition-all hover:bg-purple-500/20"
                >
                  <ExternalLink className="h-4 w-4" />
                  open in Gong
                  <span className="text-xs text-purple-400/50">
                    (assign to folder here)
                  </span>
                </a>
              )}
            </div>

            <div className="mx-auto mt-6 max-w-sm rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-left">
              <div className="flex gap-2">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div>
                  <p className="text-xs font-medium text-amber-400">processing time</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Gong will transcribe and analyze this call within ~1 hour.
                    You can assign it to a library folder from the Gong link above.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-center gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  resetImport();
                  setFile(null);
                  setSourceUrl("");
                  setTitle("");
                }}
                className="rounded-xl border-white/10 bg-white/5"
              >
                upload another
              </Button>
              <Button
                onClick={onBack}
                className="gradient-btn rounded-xl border-0 text-white"
              >
                back to calls
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -right-48 top-0 h-96 w-96 rounded-full bg-purple-500/5 blur-[120px]" />
        <div className="absolute -left-48 bottom-0 h-96 w-96 rounded-full bg-pink-500/5 blur-[120px]" />
      </div>

      {/* Header */}
      <div className="relative flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="rounded-full text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          back
        </Button>
        <div>
          <h2 className="text-3xl font-bold tracking-tight">
            import to gong <Upload className="mb-1 inline h-6 w-6 text-purple-400" />
          </h2>
          <p className="text-base text-muted-foreground">
            upload recordings manually or from a URL
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Main form */}
        <div className="space-y-5">
          {/* Mode toggle */}
          <div className="gradient-border rounded-xl p-[1px]">
            <div className="glass flex gap-1 rounded-xl p-1">
              <button
                onClick={() => {
                  setMode("manual");
                  setFile(null);
                }}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
                  mode === "manual"
                    ? "bg-purple-500/20 text-purple-400"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Upload className="h-4 w-4" />
                manual
              </button>
              <button
                onClick={() => {
                  setMode("automatic");
                  setFile(null);
                }}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
                  mode === "automatic"
                    ? "bg-purple-500/20 text-purple-400"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Link className="h-4 w-4" />
                from URL
              </button>
              <button
                onClick={() => {
                  setMode("zip");
                  setFile(null);
                }}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
                  mode === "zip"
                    ? "bg-purple-500/20 text-purple-400"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Archive className="h-4 w-4" />
                from ZIP export
              </button>
            </div>
          </div>

          {/* File upload area (manual + zip) */}
          {(mode === "manual" || mode === "zip") && (
            <div className="gradient-border rounded-xl p-[1px]">
              <div
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => !file && fileInputRef.current?.click()}
                className={`glass relative flex min-h-[160px] cursor-pointer flex-col items-center justify-center rounded-xl p-6 transition-all ${
                  dragActive
                    ? "border-purple-500/50 bg-purple-500/10"
                    : file
                    ? "cursor-default"
                    : "hover:bg-white/[0.04]"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={mode === "zip" ? ".zip,application/zip" : ACCEPTED_EXTENSIONS}
                  onChange={handleFileSelect}
                  className="hidden"
                />

                {file ? (
                  <div className="flex w-full items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/20">
                      {mode === "zip" ? (
                        <Archive className="h-5 w-5 text-purple-400" />
                      ) : (
                        <FileVideo className="h-5 w-5 text-purple-400" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{file.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatFileSize(file.size)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        clearFile();
                      }}
                      className="rounded-full text-muted-foreground hover:text-red-400"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-white/5">
                      {mode === "zip" ? (
                        <Archive className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        <Upload className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <p className="text-sm font-medium">
                      drop your file here or{" "}
                      <span className="text-purple-400">browse</span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {mode === "zip"
                        ? "ZIP: single call folder OR full export with manifest.json"
                        : "WAV, MP3, MP4, MKV, FLAC up to 1.5 GB"}
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* URL input (automatic) */}
          {mode === "automatic" && (
            <div className="gradient-border rounded-xl p-[1px]">
              <div className="glass rounded-xl p-4">
                <Label
                  htmlFor="sourceUrl"
                  className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
                >
                  Media URL
                </Label>
                <Input
                  id="sourceUrl"
                  type="url"
                  placeholder="https://storage.example.com/recording.mp4"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  className="mt-1.5 rounded-lg border-white/10 bg-white/5"
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Direct link to a publicly accessible media file (S3, GCS, etc.)
                </p>
              </div>
            </div>
          )}

          {/* ZIP-mode notice + workspace override */}
          {mode === "zip" && (
            <div className="gradient-border rounded-xl p-[1px]">
              <div className="glass space-y-4 rounded-xl p-4">
                <div className="flex items-start gap-2">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-purple-400" />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Call title, date, parties, system, and language are read from
                    each <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-[10px]">metadata.json</code>{" "}
                    inside the archive. Workspace and Primary User can be overridden
                    below — set Primary User if any original call owner is inactive
                    or lacks the import permission in this Gong tenant.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="workspace-zip" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Workspace (override)
                  </Label>
                  <select
                    id="workspace-zip"
                    value={workspaceId}
                    onChange={(e) => setWorkspaceId(e.target.value)}
                    disabled={workspacesLoading}
                    className="flex h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <option value="">
                      {workspacesLoading ? "Loading workspaces..." : "Use workspace from metadata.json"}
                    </option>
                    {workspaces.map((ws) => (
                      <option key={ws.id} value={ws.id}>
                        {ws.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="zip-primary-user" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Primary User (override)
                  </Label>
                  <Input
                    id="zip-primary-user"
                    placeholder="user@company.com or Gong userId"
                    value={zipPrimaryUserOverride}
                    onChange={(e) => setZipPrimaryUserOverride(e.target.value)}
                    className="rounded-lg border-white/10 bg-white/5"
                  />
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Leave blank to use each call&apos;s original owner from
                    metadata.json. Set this to route every imported call to one
                    designated active Gong user (the only one whose import
                    permission needs to be enabled).
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Call metadata (manual + URL only) */}
          {mode !== "zip" && (
          <div className="gradient-border rounded-xl p-[1px]">
            <div className="glass space-y-4 rounded-xl p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Call Details
              </h3>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="title" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Title
                  </Label>
                  <Input
                    id="title"
                    placeholder="Q2 Pipeline Review"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="rounded-lg border-white/10 bg-white/5"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="actualStart" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Date & Time *
                  </Label>
                  <Input
                    id="actualStart"
                    type="datetime-local"
                    value={actualStart}
                    onChange={(e) => setActualStart(e.target.value)}
                    className="rounded-lg border-white/10 bg-white/5"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="primaryUser" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Primary User (email) *
                  </Label>
                  <Input
                    id="primaryUser"
                    type="email"
                    placeholder="user@company.com"
                    value={primaryUser}
                    onChange={(e) => setPrimaryUser(e.target.value)}
                    className="rounded-lg border-white/10 bg-white/5"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="direction" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Direction
                  </Label>
                  <select
                    id="direction"
                    value={direction}
                    onChange={(e) => setDirection(e.target.value as typeof direction)}
                    className="flex h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="Inbound">Inbound</option>
                    <option value="Outbound">Outbound</option>
                    <option value="Conference">Conference</option>
                    <option value="Unknown">Unknown</option>
                  </select>
                </div>
              </div>

              {/* Workspace */}
              <div className="space-y-1.5">
                <Label htmlFor="workspace" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Workspace
                </Label>
                <select
                  id="workspace"
                  value={workspaceId}
                  onChange={(e) => setWorkspaceId(e.target.value)}
                  disabled={workspacesLoading}
                  className="flex h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                >
                  <option value="">
                    {workspacesLoading ? "Loading workspaces..." : "Default workspace"}
                  </option>
                  {workspaces.map((ws) => (
                    <option key={ws.id} value={ws.id}>
                      {ws.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Participant (optional) */}
              <div>
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Participant (optional)
                </h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    placeholder="Participant name"
                    value={partyName}
                    onChange={(e) => setPartyName(e.target.value)}
                    className="rounded-lg border-white/10 bg-white/5"
                  />
                  <Input
                    placeholder="participant@example.com"
                    type="email"
                    value={partyEmail}
                    onChange={(e) => setPartyEmail(e.target.value)}
                    className="rounded-lg border-white/10 bg-white/5"
                  />
                </div>
              </div>
            </div>
          </div>
          )}

          {/* Error */}
          {importState.status === "error" && (
            <Alert variant="destructive" className="rounded-xl border-red-500/20 bg-red-500/10">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{importState.error}</AlertDescription>
            </Alert>
          )}

          {/* Submit */}
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="gradient-btn w-full rounded-xl border-0 py-5 text-white shadow-lg shadow-purple-500/10 disabled:opacity-40"
          >
            {importState.status === "uploading" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {importState.progress}
              </>
            ) : (
              <>
                {mode === "zip" ? (
                  <Archive className="mr-2 h-4 w-4" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {mode === "manual"
                  ? "upload to gong"
                  : mode === "automatic"
                  ? "import from URL"
                  : "import ZIP to gong"}
              </>
            )}
          </Button>
        </div>

        {/* Info sidebar */}
        <div className="space-y-4">
          {/* What Gong does */}
          <div className="gradient-border rounded-xl p-[1px]">
            <div className="glass rounded-xl p-4">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-400" />
                <h3 className="text-sm font-semibold">auto-analysis</h3>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Gong automatically processes uploaded recordings with full AI analysis:
              </p>
              <div className="mt-3 space-y-2">
                {[
                  "Transcription with speaker attribution",
                  "AI briefs, outlines & highlights",
                  "Smart tracker detection",
                  "Scorecard evaluation",
                  "Interaction stats (talk ratios, questions)",
                ].map((item) => (
                  <div key={item} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-green-400" />
                    <span className="text-xs text-muted-foreground">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Limitations */}
          <div className="gradient-border rounded-xl p-[1px]">
            <div className="glass rounded-xl p-4">
              <div className="mb-3 flex items-center gap-2">
                <Info className="h-4 w-4 text-amber-400" />
                <h3 className="text-sm font-semibold">good to know</h3>
              </div>
              <div className="space-y-3">
                <div className="flex items-start gap-2.5">
                  <HardDrive className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-medium">Max file size</p>
                    <p className="text-xs text-muted-foreground">1.5 GB per upload</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <FileVideo className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-medium">Formats</p>
                    <p className="text-xs text-muted-foreground">WAV, MP3, MP4, MKV, FLAC</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-medium">Processing</p>
                    <p className="text-xs text-muted-foreground">~1 hour for transcription & AI analysis</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-medium">Rate limits</p>
                    <p className="text-xs text-muted-foreground">Each import uses 2 API calls (create + upload)</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <FolderOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-medium">Folder assignment</p>
                    <p className="text-xs text-muted-foreground">
                      Library folders can only be assigned in the Gong UI.
                      After upload, use the Gong link to organize.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* API usage note */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="shrink-0 rounded-full border-purple-500/30 bg-purple-500/10 text-[10px] text-purple-400">
                API
              </Badge>
              <p className="text-xs leading-relaxed text-muted-foreground">
                This endpoint also supports programmatic imports via{" "}
                <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-[10px]">
                  POST /api/gong/import
                </code>{" "}
                with a JSON body containing <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-[10px]">sourceUrl</code> for
                automated pipelines.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
