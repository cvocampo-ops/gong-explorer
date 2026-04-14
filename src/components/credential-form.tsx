"use client";

import { useState, type FormEvent } from "react";
import { useCredentials } from "@/components/credential-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Zap } from "lucide-react";
import type { Credentials, Provider } from "@/lib/types";

export function CredentialForm() {
  const { setCredentials } = useCredentials();
  const [provider, setProvider] = useState<Provider>("gong");
  const [accessKey, setAccessKey] = useState("");
  const [accessKeySecret, setAccessKeySecret] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    let creds: Credentials;

    if (provider === "gong") {
      const trimmedUrl = baseUrl.trim().replace(/\/+$/, "");
      if (!trimmedUrl.startsWith("https://") || !trimmedUrl.includes(".api.gong.io")) {
        setError("Base URL must be like https://us-XXXXX.api.gong.io");
        return;
      }
      creds = {
        provider: "gong",
        accessKey: accessKey.trim(),
        accessKeySecret: accessKeySecret.trim(),
        baseUrl: trimmedUrl,
      };
    } else {
      const trimmedKey = apiKey.trim();
      if (!trimmedKey) {
        setError("API Key is required");
        return;
      }
      creds = { provider: "salesloft", apiKey: trimmedKey };
    }

    setTesting(true);
    try {
      const resp = await fetch(`/api/${provider}/calls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credentials: creds,
          fromDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          toDate: new Date().toISOString(),
        }),
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? "Connection test failed");
        return;
      }

      setCredentials(creds);
    } catch {
      setError("Could not reach the server. Check your network.");
    } finally {
      setTesting(false);
    }
  }

  const providerLabel = provider === "gong" ? "gong" : "salesloft";

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      {/* Background glow effects */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-32 top-1/4 h-64 w-64 rounded-full bg-purple-500/10 blur-[100px]" />
        <div className="absolute -right-32 top-1/3 h-64 w-64 rounded-full bg-pink-500/10 blur-[100px]" />
        <div className="absolute bottom-1/4 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-cyan-500/5 blur-[80px]" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Glass card */}
        <div className="gradient-border rounded-2xl p-[1px]">
          <div className="glass rounded-2xl p-8">
            {/* Header */}
            <div className="mb-6 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg shadow-purple-500/20">
                <Zap className="h-8 w-8 text-white" />
              </div>
              <h2 className="gradient-text text-3xl font-bold">
                let&apos;s connect
              </h2>
              <p className="mt-2 text-base text-muted-foreground">
                drop your {providerLabel} api creds to get started
              </p>
            </div>

            {/* Provider toggle */}
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
              {(["gong", "salesloft"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setProvider(p);
                    setError("");
                  }}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                    provider === p
                      ? "bg-gradient-to-br from-purple-500/80 to-pink-500/80 text-white shadow-lg shadow-purple-500/20"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {p === "gong" ? "Gong" : "SalesLoft"}
                </button>
              ))}
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              {provider === "gong" ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="baseUrl" className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                      Base URL
                    </Label>
                    <Input
                      id="baseUrl"
                      placeholder="https://us-XXXXX.api.gong.io"
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      required
                      className="rounded-xl border-white/10 bg-white/5 placeholder:text-muted-foreground/50 focus:border-purple-500/50 focus:ring-purple-500/20"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="accessKey" className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                      Access Key
                    </Label>
                    <Input
                      id="accessKey"
                      placeholder="Your Gong Access Key"
                      value={accessKey}
                      onChange={(e) => setAccessKey(e.target.value)}
                      required
                      className="rounded-xl border-white/10 bg-white/5 placeholder:text-muted-foreground/50 focus:border-purple-500/50 focus:ring-purple-500/20"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="accessKeySecret" className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                      Access Key Secret
                    </Label>
                    <Input
                      id="accessKeySecret"
                      type="password"
                      placeholder="Shhh... your secret"
                      value={accessKeySecret}
                      onChange={(e) => setAccessKeySecret(e.target.value)}
                      required
                      className="rounded-xl border-white/10 bg-white/5 placeholder:text-muted-foreground/50 focus:border-purple-500/50 focus:ring-purple-500/20"
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="apiKey" className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                    API Key
                  </Label>
                  <Input
                    id="apiKey"
                    type="password"
                    placeholder="Your SalesLoft API Key"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    required
                    className="rounded-xl border-white/10 bg-white/5 placeholder:text-muted-foreground/50 focus:border-purple-500/50 focus:ring-purple-500/20"
                  />
                </div>
              )}

              {error && (
                <Alert variant="destructive" className="rounded-xl border-red-500/20 bg-red-500/10">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button
                type="submit"
                disabled={testing}
                className="gradient-btn w-full rounded-xl border-0 py-5 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition-all hover:shadow-purple-500/30 disabled:opacity-50"
              >
                {testing ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    vibing with {providerLabel}...
                  </span>
                ) : (
                  "connect"
                )}
              </Button>
            </form>

            <p className="mt-6 text-center text-xs text-muted-foreground/60">
              {provider === "gong"
                ? "find your creds at Company Settings > Ecosystem > API"
                : "find your key at SalesLoft > Settings > OAuth Applications > Personal API Key"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
