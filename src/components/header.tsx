"use client";

import { useCredentials } from "@/components/credential-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LogOut, Sparkles } from "lucide-react";

export function Header() {
  const { isConfigured, clearCredentials, credentials } = useCredentials();

  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.06] glass-strong">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-pink-500">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="gradient-text text-xl font-bold leading-tight tracking-tight">
              gong explorer
            </h1>
            <p className="text-[10px] font-medium tracking-wide text-muted-foreground/50">
              Product by The Kiln | A 2x Company
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isConfigured ? (
            <>
              <Badge variant="outline" className="gap-1.5 rounded-full border-green-500/30 bg-green-500/10 text-xs text-green-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
                live
              </Badge>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {credentials?.baseUrl.replace("https://", "")}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearCredentials}
                className="rounded-full text-muted-foreground hover:text-foreground"
              >
                <LogOut className="mr-1 h-3.5 w-3.5" />
                dip
              </Button>
            </>
          ) : (
            <Badge variant="outline" className="gap-1.5 rounded-full border-white/10 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
              offline
            </Badge>
          )}
        </div>
      </div>
    </header>
  );
}
